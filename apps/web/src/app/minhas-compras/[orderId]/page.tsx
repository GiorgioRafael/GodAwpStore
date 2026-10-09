import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ShopShell } from "@/components/shop/shop-shell";
import { ShopOrderWorkspace } from "@/components/shop/order-workspace";
import styles from "@/components/shop/shop.module.css";
import { requireShopBuyer } from "@/lib/shop/request";
import { ShopError } from "@/lib/shop/errors";

export const dynamic = "force-dynamic";
export default async function CustomerOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) notFound();
  const buyer = await requireShopBuyer().catch(error => {
    if (error instanceof ShopError && error.code === "unauthenticated") redirect(`/entrar?next=${encodeURIComponent(`/minhas-compras/${orderId}`)}`);
    throw error;
  });
  return <ShopShell buyerName={buyer.displayName}><div className={styles.accountTitle}><div><h1>Sua compra</h1><p>Pagamento, conversa e entrega em um só lugar.</p></div><Link href="/minhas-compras" className={styles.accountLink}><ArrowLeft size={16} /> Minhas compras</Link></div><ShopOrderWorkspace orderId={orderId} /></ShopShell>;
}
