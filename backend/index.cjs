const express = require('express');
const cors = require('cors');
const app = express();
const orderRoutes = require('./routes/orders.cjs');

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/orders', orderRoutes);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


