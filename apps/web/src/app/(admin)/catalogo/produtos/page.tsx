import type { Metadata } from "next";

import { ProductsManager } from "@/components/admin/products-manager";
import { listCatalogStores, listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage() {
  const [products, substores, stores] = await Promise.all([
    listProducts(),
    listSubstores(),
    listCatalogStores(),
  ]);
  // Sem key: ela era a impressão digital de TODOS os produtos, então qualquer
  // alteração — inclusive a venda de outro produto — descartava a instância
  // inteira do gerenciador. O diálogo de excluir/arquivar fechava sozinho antes
  // de mostrar o resultado, e o operador via o botão "não fazer nada". A lista
  // volta a sincronizar dentro do componente, sem remontar.
  return (
    <ProductsManager
      products={products}
      substores={substores}
      stores={stores}
    />
  );
}
