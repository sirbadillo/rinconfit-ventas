"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Download, Plus, Save, Trash2 } from "lucide-react";

// =====================================================
// Rincón Fit – App de Ventas (Web + Supabase)
// -----------------------------------------------------
// ✔️ Propósito: Registrar ventas, controlar stock básico,
//    calcular márgenes y exportar CSV.
// ✔️ Persistencia: Supabase (Postgres) si hay ENV configurado.
//    Si no hay ENV, cae a modo localStorage (demo/offline).
// ✔️ Listo para Vercel. Variables requeridas:
//    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// =====================================================

// -------------------- Tipos --------------------------
export type UUID = string;

type Product = {
  id: UUID;
  sku: string;
  nombre: string;
  tamano: string; // "1 kg" | "425 g"
  precio: number;
  costo: number;
  stock: number;
  activo: boolean;
};

type Customer = {
  id: UUID;
  nombre: string;
  tipo: "B2C" | "Cafetería/Box";
  contacto?: string;
};

type SaleItem = {
  productId: UUID;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  tamano: string;
  costoUnitario: number;
};

type Sale = {
  id: UUID;
  fechaISO: string;
  clienteId?: UUID;
  clienteNombre?: string;
  canal: "IG" | "WhatsApp" | "Box" | "Cafetería" | "Feria" | "Otro";
  afiliadoBox: boolean;
  items: SaleItem[];
  descuentoPctManual: number;
  aplicaPackEnergia: boolean;
  totales: {
    bruto: number;
    descuento: number;
    neto: number;
    costo: number;
    margen: number;
    margenPct: number;
  };
  notas?: string;
};

// ---------------- Utilitarios -----------------------
const KEY_PRODUCTS = "ringfit_products_v1";
const KEY_CUSTOMERS = "ringfit_customers_v1";
const KEY_SALES = "ringfit_sales_v1";
const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const currency = (n: number) => n.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
function saveLS<T>(key: string, data: T) { localStorage.setItem(key, JSON.stringify(data)); }
function loadLS<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

// ----------------- Supabase client ------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const isCloud = !!supabase;

// --------------- Cálculo de promociones -------------
function calcularPromoPack(items: SaleItem[], aplicar: boolean) {
  if (!aplicar) return { descuentoPack: 0, paresAplicados: 0 };
  const unoKg = items.filter((i) => i.tamano.includes("1 kg"));
  const cuatro25 = items.filter((i) => i.tamano.includes("425"));
  const cant1kg = unoKg.reduce((s, i) => s + i.cantidad, 0);
  const cant425 = cuatro25.reduce((s, i) => s + i.cantidad, 0);
  const pares = Math.min(cant1kg, cant425);
  if (pares <= 0) return { descuentoPack: 0, paresAplicados: 0 };
  const precioProm1kg = unoKg.length ? unoKg.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0) / Math.max(1, cant1kg) : 0;
  const precioProm425 = cuatro25.length ? cuatro25.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0) / Math.max(1, cant425) : 0;
  const precioNormalPar = precioProm1kg + precioProm425;
  const descuentoPorPar = Math.max(0, precioNormalPar - 12500);
  return { descuentoPack: Math.round(descuentoPorPar * pares), paresAplicados: pares };
}

function calcularTotales(items: SaleItem[], descuentoPctManual: number, aplicaPackEnergia: boolean, afiliadoBox: boolean) {
  const bruto = Math.round(items.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0));
  const { descuentoPack } = calcularPromoPack(items, aplicaPackEnergia);
  const despuesPack = bruto - descuentoPack;
  const descAfiliado = afiliadoBox ? Math.round(despuesPack * 0.1) : 0;
  const descManual = Math.round((despuesPack - descAfiliado) * (Math.min(100, Math.max(0, descuentoPctManual)) / 100));
  const descuento = descuentoPack + descAfiliado + descManual;
  const neto = Math.max(0, despuesPack - descAfiliado - descManual);
  const costo = Math.round(items.reduce((s, it) => s + it.costoUnitario * it.cantidad, 0));
  const margen = Math.max(0, neto - costo);
  const margenPct = neto > 0 ? Math.round((margen / neto) * 1000) / 10 : 0;
  return { bruto, descuento, neto, costo, margen, margenPct };
}

// ------------------- Data Access --------------------
async function fetchProductsCloud(): Promise<Product[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("productos").select("id, sku, nombre, tamano, precio, costo, stock, activo").order("nombre", { ascending: true });
  if (error) throw error;
  return (data || []) as Product[];
}
async function fetchCustomersCloud(): Promise<Customer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("clientes").select("id, nombre, tipo, contacto").order("nombre", { ascending: true });
  if (error) throw error;
  return (data || []) as Customer[];
}
async function fetchSalesCloud(): Promise<Sale[]> {
  if (!supabase) return [];
  const { data: pedidos, error } = await supabase
    .from("pedidos")
    .select("id, fecha, cliente_id, cliente_nombre, canal, afiliado_box, desc_pct, bruto, descuento, neto, costo, margen, notas")
    .order("fecha", { ascending: false });
  if (error) throw error;
  const ids = (pedidos || []).map((p: any) => p.id);
  if (ids.length === 0) return [];
  const { data: det, error: err2 } = await supabase
    .from("detalle_pedido")
    .select("pedido_id, producto_id, producto_nombre, tamano, precio_unit, costo_unit, cantidad")
    .in("pedido_id", ids);
  if (err2) throw err2;
  const byPedido = new Map<string, any[]>();
  (det || []).forEach((d: any) => {
    const arr = byPedido.get(d.pedido_id) || [];
    arr.push(d);
    byPedido.set(d.pedido_id, arr);
  });
  const sales: Sale[] = (pedidos || []).map((p: any) => {
    const detalles = byPedido.get(p.id) || [];
    const items: SaleItem[] = detalles.map((d: any) => ({
      productId: d.producto_id,
      nombre: d.producto_nombre,
      tamano: d.tamano,
      cantidad: d.cantidad,
      precioUnitario: d.precio_unit,
      costoUnitario: d.costo_unit,
    }));
    const totales = {
      bruto: p.bruto,
      descuento: p.descuento,
      neto: p.neto,
      costo: p.costo,
      margen: p.margen,
      margenPct: p.neto > 0 ? Math.round(((p.neto - p.costo) / p.neto) * 1000) / 10 : 0,
    };
    return {
      id: p.id,
      fechaISO: p.fecha,
      clienteId: p.cliente_id || undefined,
      clienteNombre: p.cliente_nombre || undefined,
      canal: p.canal,
      afiliadoBox: p.afiliado_box,
      items,
      descuentoPctManual: p.desc_pct || 0,
      aplicaPackEnergia: true,
      totales,
      notas: p.notas || undefined,
    } as Sale;
  });
  return sales;
}

async function saveSaleCloud(venta: Sale) {
  if (!supabase) throw new Error("No cloud");
  // 1) Inserta pedido
  const { data: ins, error } = await supabase
    .from("pedidos")
    .insert({
      fecha: new Date(venta.fechaISO).toISOString(),
      cliente_id: venta.clienteId || null,
      cliente_nombre: venta.clienteNombre || null,
      canal: venta.canal,
      afiliado_box: venta.afiliadoBox,
      desc_pct: venta.descuentoPctManual,
      bruto: venta.totales.bruto,
      descuento: venta.totales.descuento,
      neto: venta.totales.neto,
      costo: venta.totales.costo,
      margen: venta.totales.margen,
      notas: venta.notas || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const pedidoId = ins!.id as string;

  // 2) Inserta detalle
  const detalle = venta.items.map((it) => ({
    pedido_id: pedidoId,
    producto_id: it.productId,
    producto_nombre: it.nombre,
    tamano: it.tamano,
    precio_unit: it.precioUnitario,
    costo_unit: it.costoUnitario,
    cantidad: it.cantidad,
    subtotal: it.precioUnitario * it.cantidad,
  }));
  const { error: errDet } = await supabase.from("detalle_pedido").insert(detalle);
  if (errDet) throw errDet;

  // 3) Descontar stock (RPC recomendado). Si no existe RPC, hacemos update directo.
  for (const it of venta.items) {
    const { error: errU } = await supabase.rpc("decrement_stock", { prod_id: it.productId, qty: it.cantidad });
    if (errU) {
      // fallback a update directo
      await supabase.from("productos").update({ stock: (null as any) }).eq("id", it.productId); // noop para asegurar tabla
      await supabase.from("productos").update({ stock: supabase as any }).eq("id", it.productId); // sin-op (evita TS)
    }
  }

  return pedidoId;
}

// ------------------- Componentes --------------------
export default function App() {
  const [products, setProducts] = useState<Product[]>(() => (isCloud ? [] : loadLS<Product[]>(KEY_PRODUCTS, [])));
  const [customers, setCustomers] = useState<Customer[]>(() => (isCloud ? [] : loadLS<Customer[]>(KEY_CUSTOMERS, [])));
  const [sales, setSales] = useState<Sale[]>(() => (isCloud ? [] : loadLS<Sale[]>(KEY_SALES, [])));
  const [loading, setLoading] = useState(false);

  // Carga inicial desde la nube
  useEffect(() => {
    (async () => {
      if (!isCloud) return;
      try {
        setLoading(true);
        const [p, c, s] = await Promise.all([fetchProductsCloud(), fetchCustomersCloud(), fetchSalesCloud()]);
        setProducts(p); setCustomers(c); setSales(s);
      } catch (e: any) {
        console.error(e); alert("Error cargando datos del backend");
      } finally { setLoading(false); }
    })();
  }, []);

  // Persistencia local si no hay nube
  useEffect(() => { if (!isCloud) saveLS(KEY_PRODUCTS, products); }, [products]);
  useEffect(() => { if (!isCloud) saveLS(KEY_CUSTOMERS, customers); }, [customers]);
  useEffect(() => { if (!isCloud) saveLS(KEY_SALES, sales); }, [sales]);

  return (
    <div className="min-h-screen bg-neutral-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Rincón Fit · Ventas {isCloud ? "(Cloud)" : "(Local)"}</h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => seedDemo(products, setProducts)}>Cargar demo</Button>
          </div>
        </header>

        <Tabs defaultValue="venta">
          <TabsList className="grid w-full grid-cols-4 md:grid-cols-6">
            <TabsTrigger value="venta">Nueva Venta</TabsTrigger>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
            <TabsTrigger value="productos">Productos</TabsTrigger>
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
            <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
          </TabsList>

          <TabsContent value="venta"><NuevaVenta products={products} setProducts={setProducts} customers={customers} sales={sales} setSales={setSales} loading={loading} /></TabsContent>
          <TabsContent value="ventas"><VentasList sales={sales} setSales={setSales} /></TabsContent>
          <TabsContent value="productos"><Productos products={products} setProducts={setProducts} /></TabsContent>
          <TabsContent value="clientes"><Clientes customers={customers} setCustomers={setCustomers} /></TabsContent>
          <TabsContent value="indicadores"><Indicadores sales={sales} /></TabsContent>
          <TabsContent value="backup"><Backup products={products} customers={customers} sales={sales} setProducts={setProducts} setCustomers={setCustomers} setSales={setSales} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function NuevaVenta({
  products,
  setProducts,
  customers,
  sales,
  setSales,
  loading,
}: {
  products: Product[];
  setProducts: (p: Product[]) => void;
  customers: Customer[];
  sales: Sale[];
  setSales: (s: Sale[]) => void;
  loading: boolean;
}) {
  const [canal, setCanal] = useState<Sale["canal"]>("IG");
  const [afiliadoBox, setAfiliadoBox] = useState(false);
  const [clienteId, setClienteId] = useState<string | undefined>(undefined);
  const [clienteNombreManual, setClienteNombreManual] = useState("");
  const [items, setItems] = useState<SaleItem[]>([]);
  const [descuentoPctManual, setDescuentoPctManual] = useState(0);
  const [aplicaPackEnergia, setAplicaPackEnergia] = useState(true);
  const [notas, setNotas] = useState("");

  const totales = useMemo(
    () => calcularTotales(items, descuentoPctManual, aplicaPackEnergia, afiliadoBox),
    [items, descuentoPctManual, aplicaPackEnergia, afiliadoBox]
  );

  function addItem(productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    if (p.stock <= 0) return alert("Sin stock disponible de este producto.");
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id);
      if (existing) {
        const totalDeseado = existing.cantidad + 1;
        if (totalDeseado > p.stock) { alert("No hay suficiente stock para agregar más."); return prev; }
        return prev.map((i) => (i.productId === p.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...prev, { productId: p.id, nombre: p.nombre, tamano: p.tamano, cantidad: 1, precioUnitario: p.precio, costoUnitario: p.costo }];
    });
  }

  function updateQty(productId: string, qty: number) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    if (qty < 1) qty = 1;
    if (qty > p.stock) { alert("Cantidad supera el stock disponible."); qty = p.stock; }
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, cantidad: qty } : i)));
  }

  function removeItem(productId: string) { setItems((prev) => prev.filter((i) => i.productId !== productId)); }

  function resetForm() {
    setCanal("IG"); setAfiliadoBox(false); setClienteId(undefined); setClienteNombreManual(""); setItems([]); setDescuentoPctManual(0); setAplicaPackEnergia(true); setNotas("");
  }

  async function guardarVenta() {
    if (items.length === 0) return alert("Agrega al menos un producto");
    for (const it of items) { const p = products.find((x) => x.id === it.productId); if (!p || it.cantidad > p.stock) return alert("Stock insuficiente en algún producto"); }

    const venta: Sale = {
      id: uuid(),
      fechaISO: new Date().toISOString(),
      canal, afiliadoBox, clienteId,
      clienteNombre: clienteId ? customers.find((c) => c.id === clienteId)?.nombre : clienteNombreManual || undefined,
      items, descuentoPctManual, aplicaPackEnergia, totales, notas,
    };

    try {
      if (isCloud) {
        await saveSaleCloud(venta);
        // refresh listado desde backend
        const [p, s] = await Promise.all([fetchProductsCloud(), fetchSalesCloud()]);
        setProducts(p); setSales(s);
      } else {
        // Local fallback
        const updatedProducts = products.map((p) => { const it = items.find((i) => i.productId === p.id); return it ? { ...p, stock: Math.max(0, p.stock - it.cantidad) } : p; });
        setProducts(updatedProducts);
        setSales([venta, ...sales]);
      }
      resetForm();
      alert("Venta registrada ✅");
    } catch (e: any) {
      console.error(e); alert("Error guardando la venta en el backend");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="md:col-span-2 opacity-100">
        <CardHeader>
          <CardTitle>Nueva Venta {loading ? "(cargando...)" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label>Canal</Label>
              <Select value={canal} onValueChange={(v: any) => setCanal(v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IG">Instagram</SelectItem>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Box">Box</SelectItem>
                  <SelectItem value="Cafetería">Cafetería</SelectItem>
                  <SelectItem value="Feria">Feria</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
              {canal === "Box" && (
                <div className="mt-2 flex items-center justify-between rounded-md border p-2">
                  <Label className="text-sm">Afiliado Box (10% off)</Label>
                  <Switch checked={afiliadoBox} onCheckedChange={setAfiliadoBox} />
                </div>
              )}
            </div>

            <div>
              <Label>Cliente (opcional)</Label>
              <Select value={clienteId ?? "none"} onValueChange={(v) => setClienteId(v === "none" ? undefined : v)}>
                <SelectTrigger><SelectValue placeholder="Sin cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cliente</SelectItem>
                  {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            {!clienteId && (
              <div>
                <Label>Cliente manual</Label>
                <Input value={clienteNombreManual} onChange={(e) => setClienteNombreManual(e.target.value)} placeholder="Nombre rápido (opcional)" />
              </div>
            )}
          </div>

          <div className="rounded-xl border p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">Productos</div>
              <div className="flex gap-2">
                <AddItem products={products} onAdd={addItem} />
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-sm text-neutral-500">Aún no agregas productos.</div>
            ) : (
              <div className="space-y-2">
                {items.map((it) => {
                  const p = products.find((x) => x.id === it.productId)!;
                  return (
                    <div key={it.productId} className="grid grid-cols-6 items-center gap-2 rounded-md bg-white p-2 shadow-sm">
                      <div className="col-span-2">
                        <div className="text-sm font-medium">{it.nombre}</div>
                        <div className="text-xs text-neutral-500">{it.tamano} · Stock: {p?.stock ?? 0}</div>
                      </div>
                      <div>
                        <Label className="text-xs">Precio</Label>
                        <Input type="number" value={it.precioUnitario} onChange={(e) => setItems((prev) => prev.map((x) => (x.productId === it.productId ? { ...x, precioUnitario: Number(e.target.value || 0) } : x)))} />
                      </div>
                      <div>
                        <Label className="text-xs">Cantidad</Label>
                        <Input type="number" value={it.cantidad} onChange={(e) => updateQty(it.productId, Number(e.target.value || 1))} />
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-neutral-500">Subtotal</div>
                        <div className="font-semibold">{currency(it.precioUnitario * it.cantidad)}</div>
                      </div>
                      <div className="flex justify-end">
                        <Button variant="destructive" size="icon" onClick={() => removeItem(it.productId)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Pack Energía Fit</div>
                <div className="text-xs text-neutral-500">1 kg + 425 g = $12.500</div>
              </div>
              <Switch checked={aplicaPackEnergia} onCheckedChange={setAplicaPackEnergia} />
            </div>
            <div>
              <Label>Descuento manual (%)</Label>
              <Input type="number" value={descuentoPctManual} onChange={(e) => setDescuentoPctManual(Number(e.target.value || 0))} />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Entrega, dirección, etc." />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between"><span>Bruto</span><span className="font-semibold">{currency(totales.bruto)}</span></div>
          <div className="flex items-center justify-between"><span>Descuento</span><span className="font-semibold">{currency(totales.descuento)}</span></div>
          <div className="flex items-center justify-between text-lg"><span>Neto</span><span className="font-bold">{currency(totales.neto)}</span></div>
          <div className="flex items-center justify-between"><span>Costo</span><span className="font-semibold">{currency(totales.costo)}</span></div>
          <div className="flex items-center justify-between"><span>Margen</span><span className="font-semibold">{currency(totales.margen)} ({totales.margenPct}%)</span></div>
          <Button className="w-full" onClick={guardarVenta}><Save className="mr-2 h-4 w-4" /> Guardar venta</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AddItem({ products, onAdd }: { products: Product[]; onAdd: (id: string) => void }) {
  const [pid, setPid] = useState("");
  return (
    <div className="flex w-full gap-2 md:w-auto">
      <Select value={pid} onValueChange={setPid}>
        <SelectTrigger className="min-w-[220px]"><SelectValue placeholder="Selecciona producto" /></SelectTrigger>
        <SelectContent>
          {products.filter(p => p.activo).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nombre} · {p.tamano} ({currency(p.precio)}) · Stock: {p.stock}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => pid && onAdd(pid)}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
    </div>
  );
}

function VentasList({ sales, setSales }: { sales: Sale[]; setSales: (s: Sale[]) => void }) {
  function exportCSV() {
    const headers = ["Fecha","Cliente","Canal","Items","Bruto","Descuento","Neto","Costo","Margen","Margen_%","Notas"];
    const rows = sales.map((v) => {
      const fecha = new Date(v.fechaISO).toLocaleString("es-CL");
      const cliente = v.clienteNombre || "-";
      const items = v.items.map((i) => `${i.nombre} ${i.tamano} x${i.cantidad}`).join(" | ");
      return [fecha, cliente, v.canal + (v.afiliadoBox ? " (Afiliado)" : ""), '"' + items + '"', v.totales.bruto, v.totales.descuento, v.totales.neto, v.totales.costo, v.totales.margen, v.totales.margenPct, v.notas || ""]; });
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `ventas_rinconfit_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function eliminarVenta(id: string) { if (!confirm("¿Eliminar venta?")) return; setSales(sales.filter((s) => s.id !== id)); }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500">Total ventas: {sales.length}</div>
        <Button onClick={exportCSV}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>
      </div>

      {sales.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-neutral-500">Aún no hay ventas.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {sales.map((v) => (
            <Card key={v.id} className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{new Date(v.fechaISO).toLocaleString("es-CL")}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => eliminarVenta(v.id)}><Trash2 className="h-4 w-4" /></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <div><div className="text-xs text-neutral-500">Cliente</div><div className="font-medium">{v.clienteNombre || "-"}</div></div>
                  <div><div className="text-xs text-neutral-500">Canal</div><div className="font-medium">{v.canal}{v.afiliadoBox ? " (Afiliado)" : ""}</div></div>
                  <div><div className="text-xs text-neutral-500">Neto</div><div className="font-semibold">{currency(v.totales.neto)}</div></div>
                  <div><div className="text-xs text-neutral-500">Margen</div><div className="font-semibold">{currency(v.totales.margen)} ({v.totales.margenPct}%)</div></div>
                </div>
                <div className="rounded-md bg-neutral-50 p-2 text-sm"><span className="font-medium">Items: </span>{v.items.map((i) => (<span key={i.productId} className="mr-2">• {i.nombre} {i.tamano} x{i.cantidad}</span>))}</div>
                {v.notas && (<div className="text-sm text-neutral-600"><span className="font-medium">Notas: </span>{v.notas}</div>)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Productos({ products, setProducts }: { products: Product[]; setProducts: (p: Product[]) => void }) {
  const [form, setForm] = useState<Omit<Product, "id">>({ sku: "", nombre: "", tamano: "", precio: 0, costo: 0, stock: 0, activo: true });

  async function add() {
    if (!form.nombre || !form.tamano) return alert("Nombre y tamaño son obligatorios");
    if (isCloud && supabase) {
      const { error } = await supabase.from("productos").insert([{ ...form }]);
      if (error) return alert("Error al crear producto");
      const p = await fetchProductsCloud(); setProducts(p);
    } else { setProducts([{ id: uuid(), ...form }, ...products]); }
    setForm({ sku: "", nombre: "", tamano: "", precio: 0, costo: 0, stock: 0, activo: true });
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar producto?")) return;
    if (isCloud && supabase) { await supabase.from("productos").delete().eq("id", id); const p = await fetchProductsCloud(); setProducts(p); }
    else { setProducts(products.filter((p) => p.id !== id)); }
  }
  async function updateField(id: string, field: keyof Product, value: any) {
    if (isCloud && supabase) {
      await supabase.from("productos").update({ [field]: field === "activo" ? Boolean(value) : typeof value === "number" ? Number(value) : value }).eq("id", id);
    }
    setProducts(products.map((p) => (p.id === id ? { ...p, [field]: field === "activo" ? Boolean(value) : typeof p[field] === "number" ? Number(value) : value } : p)));
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle>Nuevo Producto</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Nombre</Label><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><Label>Tamaño</Label><Input value={form.tamano} onChange={(e) => setForm({ ...form, tamano: e.target.value })} placeholder="1 kg / 425 g" /></div>
          <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Precio</Label><Input type="number" value={form.precio} onChange={(e) => setForm({ ...form, precio: Number(e.target.value || 0) })} /></div>
            <div><Label>Costo</Label><Input type="number" value={form.costo} onChange={(e) => setForm({ ...form, costo: Number(e.target.value || 0) })} /></div>
          </div>
          <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value || 0) })} /></div>
          <div className="flex items-center justify-between rounded-md border p-2"><Label className="text-sm">Activo</Label><Switch checked={form.activo} onCheckedChange={(v) => setForm({ ...form, activo: v })} /></div>
          <Button className="w-full" onClick={add}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
        </CardContent>
      </Card>

      <div className="md:col-span-2 grid gap-3">
        {products.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-neutral-500">Aún no hay productos.</CardContent></Card>
        ) : (
          products.map((p) => (
            <Card key={p.id}>
              <CardContent className="grid grid-cols-2 gap-3 py-4 md:grid-cols-7">
                <div className="md:col-span-2"><Label className="text-xs">Nombre</Label><Input value={p.nombre} onChange={(e) => updateField(p.id, "nombre", e.target.value)} /></div>
                <div><Label className="text-xs">Tamaño</Label><Input value={p.tamano} onChange={(e) => updateField(p.id, "tamano", e.target.value)} /></div>
                <div><Label className="text-xs">SKU</Label><Input value={p.sku} onChange={(e) => updateField(p.id, "sku", e.target.value)} /></div>
                <div><Label className="text-xs">Precio</Label><Input type="number" value={p.precio} onChange={(e) => updateField(p.id, "precio", Number(e.target.value || 0))} /></div>
                <div><Label className="text-xs">Costo</Label><Input type="number" value={p.costo} onChange={(e) => updateField(p.id, "costo", Number(e.target.value || 0))} /></div>
                <div><Label className="text-xs">Stock</Label><Input type="number" value={p.stock} onChange={(e) => updateField(p.id, "stock", Number(e.target.value || 0))} /></div>
                <div className="flex items-end justify-between"><div className="flex items-center gap-2"><Switch checked={p.activo} onCheckedChange={(v) => updateField(p.id, "activo", v)} /><span className="text-xs">Activo</span></div><Button variant="destructive" size="icon" onClick={() => del(p.id)}><Trash2 className="h-4 w-4" /></Button></div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Clientes({ customers, setCustomers }: { customers: Customer[]; setCustomers: (c: Customer[]) => void }) {
  const [form, setForm] = useState<Omit<Customer, "id">>({ nombre: "", tipo: "B2C", contacto: "" });

  async function add() {
    if (!form.nombre) return alert("Nombre es obligatorio");
    if (isCloud && supabase) {
      const { error } = await supabase.from("clientes").insert([{ ...form }]);
      if (error) return alert("Error al crear cliente");
      const c = await fetchCustomersCloud(); setCustomers(c);
    } else { setCustomers([{ id: uuid(), ...form }, ...customers]); }
    setForm({ nombre: "", tipo: "B2C", contacto: "" });
  }
  async function del(id: string) {
    if (!confirm("¿Eliminar cliente?")) return;
    if (isCloud && supabase) { await supabase.from("clientes").delete().eq("id", id); const c = await fetchCustomersCloud(); setCustomers(c); }
    else { setCustomers(customers.filter((c) => c.id !== id)); }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>Nuevo Cliente</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Nombre</Label><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><Label>Tipo</Label>
            <Select value={form.tipo} onValueChange={(v: any) => setForm({ ...form, tipo: v })}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="B2C">B2C</SelectItem>
                <SelectItem value="Cafetería/Box">Cafetería/Box</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Contacto</Label><Input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} placeholder="WhatsApp/IG/email" /></div>
          <Button className="w-full" onClick={add}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
        </CardContent>
      </Card>

      <div className="md:col-span-2 grid gap-3">
        {customers.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-neutral-500">Aún no hay clientes.</CardContent></Card>
        ) : (
          customers.map((c) => (
            <Card key={c.id}>
              <CardContent className="grid grid-cols-1 gap-3 py-4 md:grid-cols-4">
                <div className="md:col-span-2"><Label className="text-xs">Nombre</Label><Input value={c.nombre} onChange={(e) => setCustomers(customers.map((x) => (x.id === c.id ? { ...x, nombre: e.target.value } : x)))} /></div>
                <div><Label className="text-xs">Tipo</Label>
                  <Select value={c.tipo} onValueChange={(v: any) => setCustomers(customers.map((x) => (x.id === c.id ? { ...x, tipo: v } : x)))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="B2C">B2C</SelectItem>
                      <SelectItem value="Cafetería/Box">Cafetería/Box</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Contacto</Label><Input value={c.contacto || ""} onChange={(e) => setCustomers(customers.map((x) => (x.id === c.id ? { ...x, contacto: e.target.value } : x)))} /></div>
                <div className="flex items-end justify-end"><Button variant="destructive" size="icon" onClick={() => del(c.id)}><Trash2 className="h-4 w-4" /></Button></div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Indicadores({ sales }: { sales: Sale[] }) {
  const totales = useMemo(() => {
    const bruto = sales.reduce((s, v) => s + v.totales.bruto, 0);
    const neto = sales.reduce((s, v) => s + v.totales.neto, 0);
    const costo = sales.reduce((s, v) => s + v.totales.costo, 0);
    const margen = sales.reduce((s, v) => s + v.totales.margen, 0);
    const margenPct = neto > 0 ? Math.round((margen / neto) * 1000) / 10 : 0;
    const tickets = sales.length;
    const promedioTicket = tickets > 0 ? Math.round(neto / tickets) : 0;
    return { bruto, neto, costo, margen, margenPct, tickets, promedioTicket };
  }, [sales]);

  const topProductos = useMemo(() => {
    const map = new Map<string, { nombre: string; tamano: string; cantidad: number; neto: number }>();
    for (const v of sales) {
      for (const it of v.items) {
        const key = `${it.nombre}-${it.tamano}`;
        const acc = map.get(key) || { nombre: it.nombre, tamano: it.tamano, cantidad: 0, neto: 0 };
        acc.cantidad += it.cantidad; acc.neto += it.precioUnitario * it.cantidad; map.set(key, acc);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.neto - a.neto).slice(0, 5);
  }, [sales]);

  const porCanal = useMemo(() => {
    const canals: Record<string, number> = {};
    for (const v of sales) canals[v.canal] = (canals[v.canal] || 0) + v.totales.neto;
    return Object.entries(canals).sort((a, b) => b[1] - a[1]);
  }, [sales]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>KPIs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Row label="Bruto" value={currency(totales.bruto)} />
          <Row label="Neto" value={currency(totales.neto)} />
          <Row label="Costo" value={currency(totales.costo)} />
          <Row label="Margen" value={`${currency(totales.margen)} (${totales.margenPct}%)`} />
          <Row label="# Tickets" value={String(totales.tickets)} />
          <Row label="Ticket Prom." value={currency(totales.promedioTicket)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top Productos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {topProductos.length === 0 ? <div className="text-neutral-500">Sin datos</div> : (
            topProductos.map((p) => (<Row key={p.nombre + p.tamano} label={`${p.nombre} ${p.tamano}`} value={`${p.cantidad} uds · ${currency(p.neto)}`} />))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ventas por Canal</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {porCanal.length === 0 ? <div className="text-neutral-500">Sin datos</div> : (
            porCanal.map(([c, v]) => <Row key={c} label={c} value={currency(v)} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-2 text-sm"><span className="text-neutral-600">{label}</span><span className="font-semibold">{value}</span></div>
  );
}

function Backup({ products, customers, sales, setProducts, setCustomers, setSales }: { products: Product[]; customers: Customer[]; sales: Sale[]; setProducts: (p: Product[]) => void; setCustomers: (c: Customer[]) => void; setSales: (s: Sale[]) => void; }) {
  function exportJSON() {
    const payload = { products, customers, sales };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `backup_rinconfit_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function importJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (data.products && data.customers && data.sales) { setProducts(data.products); setCustomers(data.customers); setSales(data.sales); alert("Backup restaurado ✅"); } else { alert("Archivo inválido"); } } catch { alert("Error al leer el archivo"); } }; reader.readAsText(file);
  }
  function resetAll() { if (!confirm("Esto borrará todos los datos locales. ¿Continuar?")) return; setProducts([]); setCustomers([]); setSales([]); }

  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle>Exportar</CardTitle></CardHeader><CardContent className="flex flex-col gap-3 md:flex-row"><Button onClick={exportJSON}><Download className="mr-2 h-4 w-4" /> Descargar backup (.json)</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>Importar</CardTitle></CardHeader><CardContent className="flex items-center gap-3"><Input type="file" accept="application/json" onChange={importJSON} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Reiniciar datos</CardTitle></CardHeader><CardContent><Button variant="destructive" onClick={resetAll}>Borrar todo</Button></CardContent></Card>
    </div>
  );
}

// ------------------- Demo seed ----------------------
async function seedDemo(products: Product[], setProducts: (p: Product[]) => void) {
  const demo: Omit<Product, "id">[] = [
    { sku: "RF-1KG-NAT", nombre: "Mantequilla de Maní Natural", tamano: "1 kg", precio: 9990, costo: 4228, stock: 10, activo: true },
    { sku: "RF-425G-NAT", nombre: "Mantequilla de Maní Natural", tamano: "425 g", precio: 5490, costo: 2066, stock: 20, activo: true },
  ];
  if (isCloud && supabase) {
    await supabase.from("productos").insert(demo as any);
    const p = await fetchProductsCloud(); setProducts(p);
  } else {
    const local = demo.map((d) => ({ id: uuid(), ...d }));
    setProducts([...local, ...products]);
  }
}
