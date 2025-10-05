const express = require('express');
const cors = require('cors');
const app = express();
const orderRoutes = require('./routes/orders.cjs');

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/orders', orderRoutes);
const PORT = process.env.PORT || 5000;
app.get('/', (_req, res) => {
  res.send('API OK. Try GET /orders or POST /orders');
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


