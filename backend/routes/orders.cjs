const express = require('express');
const router = express.Router();

const prisma = require('../db.cjs');
const { cacheGet, cacheSet, cacheDelByPrefix } = require('../redis.cjs');

/**
 * GET /orders?page=&limit=&q=
 * - Pagination: page (default 1), limit (default 10)
 * - Search: q (matches user email OR product name; case-insensitive)
 * - Caching: 30s TTL; invalidated on create
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
    const q = (req.query.q || '').trim();
    const skip = (page - 1) * limit;

    const cacheKey = `orders:list:p=${page}:l=${limit}:q=${q}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Build where clause
    const where = q
      ? {
          OR: [
            { user: { email: { contains: q, mode: 'insensitive' } } },
            {
              items: {
                some: { product: { name: { contains: q, mode: 'insensitive' } } },
              },
            },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          user: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // Map to a simple shape like before
    const data = rows.map((o) => ({
      id: o.id,
      status: o.status || 'PENDING',
      created_at: o.createdAt,
      user: { id: o.user.id, email: o.user.email, name: o.user.name },
      items: o.items.map((it) => ({
        id: it.id,
        quantity: it.quantity,
        product: {
          id: it.product.id,
          name: it.product.name,
          price: it.product.price,
        },
      })),
    }));

    const payload = { total, page, limit, data };
    await cacheSet(cacheKey, payload, 30);
    res.json(payload);
  } catch (err) {
    console.error('GET /orders error', err);   // or 'POST /orders error'
    res.status(500).json({ error: 'Error fetching orders', detail: String(err) });
  }
});

/**
 * POST /orders
 * Body:
 * {
 *   "user_id": number,
 *   "items": [{ "product_id": number, "quantity": number }]
 * }
 * - Transactional create (order + items)
 * - Invalidate list caches
 * - Mock async confirmation (PENDING -> CONFIRMED after ~2s)
 */
// expected payload:
// { "user_id": 1, "items": [ { "product_id": 1, "quantity": 2 } ] }

router.post('/', async (req, res) => {
  try {
    const { user_id, items } = req.body;

    if (!user_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'user_id and items[] are required' });
    }

    // Create the order using scalar FKs; let DB defaults handle status/createdAt
    const created = await prisma.order.create({
      data: {
        userId: Number(user_id),
        items: {
          create: items.map(i => ({
            productId: Number(i.product_id),
            quantity: Number(i.quantity),
          })),
        },
      },
      include: {
        items: { include: { product: true } },
        user: true,
      },
    });

    // Invalidate list caches so GET shows the new order
    await cacheDelByPrefix('orders:list:');

    // Mock async confirmation (optional)
    setTimeout(async () => {
      try {
        await prisma.order.update({
          where: { id: created.id },
          data: { status: 'CONFIRMED' }, // remove this if your model has no status
        });
        await cacheDelByPrefix('orders:list:');
      } catch (e) {
        console.error('Async confirm error:', e);
      }
    }, 2000);

    // Response shape like GET mapping
    res.json({
      id: created.id,
      status: created.status,
      created_at: created.createdAt,
      user: { id: created.user.id, email: created.user.email, name: created.user.name },
      items: created.items.map((it) => ({
        id: it.id,
        quantity: it.quantity,
        product: {
          id: it.product.id,
          name: it.product.name,
          price: it.product.price,
        },
      })),
    });
  } catch (err) {
    console.error('POST /orders error', err);   // or 'POST /orders error'
    res.status(500).json({ error: 'Error fetching orders', detail: String(err) });
  }
});


module.exports = router;
