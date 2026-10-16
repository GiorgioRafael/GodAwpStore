import Link from "next/link";
import { ArrowUpRight, Headset, MessagesSquare, PackageCheck, QrCode } from "lucide-react";
import type { ShopInformation } from "@/lib/shop/information";
import ui from "./shop.module.css";
import styles from "./store-benefits.module.css";

const BENEFITS = [
  {
    icon: QrCode,
    title: "Pagamento via Pix",
    text: "Entre na sua conta e gere o Pix do seu pedido.",
  },
  {
    icon: PackageCheck,
    title: "Entrega pela equipe",
    text: "Combine os detalhes da entrega com a equipe da loja.",
  },
  {
    icon: Headset,
    title: "Atendimento no site",
    text: "Chat privado da sua compra disponível após o pagamento.",
  },
];

export function StoreBenefits({ information }: { information?: ShopInformation }) {
  const supportHref = information?.supportUrl || "/atendimento";
  const supportLabel = information?.supportUrl ? information.supportLabel : "Falar com a loja";

  return <section className={styles.section} aria-label="Comprar na GWStore">
    <div className={ui.container}>
      <ul className={styles.benefits}>
        {BENEFITS.map(({ icon: Icon, title, text }) => <li key={title} className={styles.benefit}>
          <div className={styles.benefitCopy}><h3>{title}</h3><p>{text}</p></div>
          <span className={styles.benefitIcon} aria-hidden="true"><Icon strokeWidth={1.5} /></span>
        </li>)}
      </ul>

      <div className={styles.contact}>
        <span className={styles.contactIcon} aria-hidden="true"><MessagesSquare size={28} strokeWidth={1.6} /></span>
        <div className={styles.contactCopy}>
          <h2>Seu próximo upgrade começa com a gente.</h2>
          <p>Tire suas dúvidas e confira os detalhes antes de comprar.</p>
        </div>
        <Link href={supportHref} className={styles.contactLink} rel={information?.supportUrl ? "noreferrer" : undefined}>
          {supportLabel}<ArrowUpRight size={19} aria-hidden="true" />
        </Link>
      </div>
    </div>
  </section>;
}
