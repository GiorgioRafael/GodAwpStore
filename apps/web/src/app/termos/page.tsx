import { StoreInformationPage } from "@/components/shop/information-page";
import { shopInformationMetadata } from "@/lib/shop/information-metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return shopInformationMetadata("/termos", { title: "Termos de compra · GWStore", description: "Informações sobre produtos, conta, pagamento e entrega na GWStore." });
}
export default function Page() { return <StoreInformationPage section="termos" />; }
