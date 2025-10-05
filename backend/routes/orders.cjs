const express = require('express');
const router = express.Router();
const db = require('../db');
const { redis, cacheGet, cacheSet, cacheDelByPrefix } = require('../redis.cjs');

/**
 * GET /orders?page=&limit=&q=
 * - pagination: page, limit
 * - search (optional): q — matches user email OR product name
 * - 30s Redis cache
 */
router.get('/', async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
  const q = (req.query.q || '').trim();
  const offset = (page - 1) * limit;

  const cacheKey = `orders:list:p=${page}:l=${limit}:q=${q}`;
  try {
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // where clause for search
    const where = q
      ? `
        WHERE u.email ILIKE $1
           OR EXISTS (
              SELECT 1 FROM order_items oi
              JOIN products p2 ON p2.id = oi.product_id
              WHERE oi.order_id = o.id AND p2.name ILIKE $1
           )
      `
      : '';

    const params = q ? [`%${q}%`, limit, offset] : [limit, offset];

    const totalSql = `
      SELECT COUNT(*)::int AS total
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ${q ? 'WHERE u.email ILIKE $1 OR EXISTS (SELECT 1 FROM order_items oi JOIN products p2 ON p2.id = oi.product_id WHERE oi.order_id = o.id AND p2.name ILIKE $1)' : ''}
    `;

    const listSql = `
      SELECT o.id, o.status, o.created_at, u.id as user_id, u.email, u.name
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${q ? 2 : 1} OFFSET $${q ? 3 : 2}
    `;

    const totalRow = await db.query(totalSql, q ? [`%${q}%`] : []);
    const list = await db.query(listSql, params);
    const orderIds = list.rows.map(r => r.id);

    // fetch items for these orders
    let itemsByOrder = {};
    if (orderIds.length) {
      const itemsRes = await db.query(`
        SELECT oi.id, oi.order_id, oi.quantity, p.id as product_id, p.name, p.price
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1::int[])
      `, [orderIds]);
      itemsRes.rows.forEach(row => {
        if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
        itemsByOrder[row.order_id].push({
          id: row.id,
          quantity: row.quantity,
          product: { id: row.product_id, name: row.name, price: row.price }
        });
      });
    }

    const data = list.rows.map(r => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      user: { id: r.user_id, email: r.email, name: r.name },
      items: itemsByOrder[r.id] || [],
    }));

    const payload = { total: totalRow.rows[0].total, page, limit, data };
    await cacheSet(cacheKey, payload, 30); // 30s TTL
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching orders');
  }
});

/**
 * POST /orders
 * { user_id: number, items: [{ product_id, quantity }] }
 * - Transactional insert (orders + order_items)
 * - Invalidate cache
 * - Mock async confirmation via Redis queue or setTimeout
 */
router.post('/', async (req, res) => {
  const { user_id, items } = req.body || {};

  if (!user_id || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'user_id and items[] are required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `INSERT INTO orders (user_id, status) VALUES ($1, 'PENDING') RETURNING id, user_id, status, created_at`,
      [user_id]
    );
    const order = orderRes.rows[0];

    const values = [];
    const placeholders = [];
    items.forEach((it, idx) => {
      const base = idx * 3;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      values.push(order.id, it.product_id, it.quantity);
    });

    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity) VALUES ${placeholders.join(',')}`,
      values
    );

    await client.query('COMMIT');

    // Invalidate all list caches
    await cacheDelByPrefix('orders:list:');

    // Enqueue mock confirmation (choose one strategy)
    // A) Simple: setTimeout that updates DB after 2s
    setTimeout(async () => {
      try {
        await db.query(`UPDATE orders SET status='CONFIRMED' WHERE id=$1`, [order.id]);
        // optional: also invalidate caches so subsequent GET shows CONFIRMED
        await cacheDelByPrefix('orders:list:');
      } catch (e) { console.error('confirm job failed', e); }
    }, 2000);

    res.json({ ...order, items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Error creating order');
  } finally {
    client.release();
  }
});

module.exports = router;
