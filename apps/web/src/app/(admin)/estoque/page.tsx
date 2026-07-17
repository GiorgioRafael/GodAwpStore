import { redirect } from "next/navigation";

export default async function InventoryPage() {
  redirect("/catalogo/produtos");
}
