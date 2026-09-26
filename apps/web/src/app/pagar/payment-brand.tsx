import Image from "next/image";

import styles from "./payment-link.module.css";

export function PaymentBrand() {
  return <div className={styles.brand}>
    <Image className={styles.brandIcon} src="/icon.png" width={52} height={52} alt="" priority />
    <div>
      <p className={styles.brandName}>GWStore</p>
      <p className={styles.brandSubline}>Pagamento via Pix</p>
    </div>
  </div>;
}
