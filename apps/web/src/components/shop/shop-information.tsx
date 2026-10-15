import Link from "next/link";
import { Clock3, MessagesSquare } from "lucide-react";
import type { ShopInformation } from "@/lib/shop/information";
import ui from "./shop.module.css";
import styles from "./information.module.css";

export function ShopInformationLinks() {
  return <><Link href="/atendimento">Atendimento e entrega</Link><Link href="/reembolsos">Cancelamento e reembolso</Link>
    <Link href="/termos">Termos de compra</Link><Link href="/privacidade">Privacidade</Link></>;
}

export function BeforeBuying({ information }: { information?: ShopInformation }) {
  return <section className={`${ui.container} ${styles.beforeBuying}`} aria-labelledby="before-buying-title">
    <div><h2 id="before-buying-title">Tudo certo antes de comprar</h2>
      <p>A entrega é feita pela equipe. Confira os requisitos do produto e o prazo antes de pagar.</p>
      {information?.hours ? <p><Clock3 size={16} aria-hidden="true" />{information.hours} · horário de Brasília</p> : null}
    </div>
    <div className={styles.actions}><Link href="/atendimento" className={ui.secondaryButton}>Prazos e atendimento</Link>
      {information?.supportUrl ? <a href={information.supportUrl} className={ui.secondaryButton} rel="noreferrer"><MessagesSquare size={16} aria-hidden="true" />{information.supportLabel}</a> : null}</div>
  </section>;
}

export function DeliveryInformation({ information, hasServices = false, hasRobux = false }: {
  information?: ShopInformation; hasServices?: boolean; hasRobux?: boolean;
}) {
  const delivery = hasServices ? information?.serviceDelivery : hasRobux ? information?.robuxDelivery : information?.digitalDelivery;
  return <div className={styles.deliveryNote}>
    <p><strong>Entrega pela equipe.</strong> {delivery || "Confirme o prazo de entrega com a equipe antes de pagar."}</p>
    {information?.hours ? <p>Atendimento: {information.hours} (Brasília).</p> : null}
    <Link href="/atendimento">Ver prazos e falar com a loja</Link>
  </div>;
}
