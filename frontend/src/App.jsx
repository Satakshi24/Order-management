import React, { useEffect, useState } from "react";

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

console.log('VITE env →', import.meta.env);
console.log('API_BASE →', import.meta.env.VITE_API_BASE);

export default function App() {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ user_id: "", product_id: "", quantity: "" });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit });
    if (q) params.set("q", q);
    const res = await fetch(`${API_BASE}/orders?` + params.toString());
    const data = await res.json();
    setOrders(data.data || []);
    setTotal(data.total || 0);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page]);

  const onSearch = () => { setPage(1); load(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      user_id: Number(form.user_id),
      items: [{ product_id: Number(form.product_id), quantity: Number(form.quantity) }],
    };
    await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setForm({ user_id: "", product_id: "", quantity: "" });
    setQ("");
    setPage(1);
    await load();
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-center">Orders</h1>

      {/* Search */}
      <div className="flex gap-2">
        <input
          className="flex-1 border p-2 rounded"
          placeholder="Search by user email or product name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button onClick={onSearch} className="bg-zinc-900 text-white px-4 py-2 rounded">
          Search
        </button>
      </div>

      {/* Create Order */}
      <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-3 items-end">
        <input
          className="border p-2 rounded"
          placeholder="User ID"
          value={form.user_id}
          onChange={(e) => setForm({ ...form, user_id: e.target.value })}
          required
        />
        <input
          className="border p-2 rounded"
          placeholder="Product ID"
          value={form.product_id}
          onChange={(e) => setForm({ ...form, product_id: e.target.value })}
          required
        />
        <input
          className="border p-2 rounded"
          placeholder="Quantity"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          required
        />
        <button className="bg-blue-600 text-white px-4 py-2 rounded">Create</button>
      </form>

      {/* List */}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="border rounded p-4">
              <div className="flex justify-between">
                <div>
                  <b>Order #{o.id}</b> —{" "}
                  <span className={o.status === "CONFIRMED" ? "text-green-600" : "text-orange-600"}>
                    {o.status}
                  </span>
                </div>
                <div className="text-sm text-zinc-500">
                  {new Date(o.created_at).toLocaleString()}
                </div>
              </div>
              <div className="text-sm text-zinc-600">User: {o.user?.email}</div>
              {o.items?.length ? (
                <ul className="mt-2 list-disc ml-6">
                  {o.items.map((it) => (
                    <li key={it.id}>
                      {it.product.name} × {it.quantity} (${it.product.price})
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {!orders.length && <div className="text-sm text-zinc-500">No orders.</div>}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Prev
        </button>
        <span>
          Page {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
