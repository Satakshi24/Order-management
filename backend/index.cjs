const express = require('express');
const cors = require('cors');
const app = express();
const orderRoutes = require('./routes/orders.cjs');

app.use(cors({ origin: '*' }));
const allowedOrigins = [
  'http://localhost:5173',
  'https://order-management-satakshi-gargs-projects.vercel.app', 
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400,
}));
app.options('/(.*)', cors());

app.use(express.json());
app.use('/orders', orderRoutes);
const PORT = process.env.PORT || 5000;
app.get('/', (_req, res) => {
  res.send('API OK. Try GET /orders or POST /orders');
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


