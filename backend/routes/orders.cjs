const express = require('express');
const router = express.Router();

const prisma = require('../db');
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
    console.error('GET /orders error', err);
    res.status(500).json({ error: 'Error fetching orders' });
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
router.post('/', async (req, res) => {
  const { user_id, items } = req.body || {};

  if (!user_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'user_id and items[] are required' });
  }

  // Basic validation for quantities
  for (const it of items) {
    if (!it?.product_id || !it?.quantity || it.quantity <= 0) {
      return res
        .status(400)
        .json({ error: 'Each item requires product_id and positive quantity' });
    }
  }

  try {
    // Transactional create
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          user: { connect: { id: user_id } },
          status: 'PENDING',
        },
      });

      await tx.orderItem.createMany({
        data: items.map((it) => ({
          orderId: order.id,
          productId: it.product_id,
          quantity: it.quantity,
        })),
      });

      // Return with joins
      const full = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          user: true,
          items: { include: { product: true } },
        },
      });

      return full;
    });

    // Invalidate list caches
    await cacheDelByPrefix('orders:list:');

    // Mock async confirmation after ~2s
    setTimeout(async () => {
      try {
        await prisma.order.update({
          where: { id: created.id },
          data: { status: 'CONFIRMED' },
        });
        await cacheDelByPrefix('orders:list:');
      } catch (e) {
        console.error('Confirm job failed', e);
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
    console.error('POST /orders error', err);
    res.status(500).json({ error: 'Error creating order' });
  }
});

module.exports = router;
