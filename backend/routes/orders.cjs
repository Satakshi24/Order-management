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

// routes/orders.cjs
router.post('/', async (req, res) => {
  try {
    const { user_id, items = [] } = req.body;

    const userId = Number(user_id);
    const itemsData = items.map(i => ({
      productId: Number(i.product_id),
      quantity: Number(i.quantity),
    }));

    // (optional but recommended) existence checks with friendly errors
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ error: 'User not found in DB' });

    const productIds = itemsData.map(i => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'One or more product_id do not exist in DB' });
    }

    const created = await prisma.order.create({
      data: {
        userId,                     // <-- FK column on Order
        status: 'PENDING',
        items: { create: itemsData } // <-- FK column on OrderItem is productId
      },
      include: { items: true }
    });

    // invalidate list cache here if you cache GET /orders
    await cacheDelByPrefix('orders:list:');

    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error creating order', detail: String(e) });
  }
});


module.exports = router;
