import Link from "next/link";
import { notFound } from "next/navigation";
import { IS_GWSTORE } from "@/lib/brand";
import { getShopInformation, type ShopInformation } from "@/lib/shop/information";
import { ShopBrandLink } from "./shop-ui";
import ui from "./shop.module.css";
import styles from "./information.module.css";

const PAGES = {
  atendimento: { title: "Atendimento e entrega", lead: "Saiba como receber seu produto e conversar com a equipe da GWStore." },
  termos: { title: "Termos de compra", lead: "As informações essenciais para comprar e acompanhar seu pedido na GWStore." },
  privacidade: { title: "Privacidade", lead: "Como os dados da sua conta, compra e atendimento são usados na loja." },
  reembolsos: { title: "Cancelamento e reembolso", lead: "Como pedir ajuda com um pagamento, cancelar uma compra ou solicitar reembolso." },
};
export type InformationPageKey = keyof typeof PAGES;

export function StoreInformationPage({ section }: { section: InformationPageKey }) {
  if (!IS_GWSTORE) notFound();
  const info = getShopInformation();
  const page = PAGES[section];
  return <div className={ui.shop}>
    <header className={`${ui.container} ${styles.pageHeader}`}><ShopBrandLink label="GWStore, início" />
      <Link href="/" className={ui.secondaryButton}>Voltar à loja</Link></header>
    <main className={`${ui.container} ${styles.pageMain}`}>
      <nav className={styles.pageNav} aria-label="Informações da loja">{Object.entries(PAGES).map(([key, value]) =>
        <Link key={key} href={`/${key}`} aria-current={key === section ? "page" : undefined}>{value.title}</Link>)}</nav>
      <h1 className={styles.pageTitle}>{page.title}</h1><p className={styles.lead}>{page.lead}</p>
      <div className={styles.body}>{section === "atendimento" ? <SupportContent info={info} />
        : section === "termos" ? <TermsContent /> : section === "privacidade" ? <PrivacyContent /> : <RefundContent />}
        <SupportContact info={info} />
        {info.operatorName || info.operatorDocument || info.operatorAddress ? <section><h2>Responsável pela loja</h2>
          {info.operatorName ? <p>{info.operatorName}</p> : null}{info.operatorDocument ? <p>{info.operatorDocument}</p> : null}
          {info.operatorAddress ? <p>{info.operatorAddress}</p> : null}</section> : null}
      </div>
    </main>
    <footer className={`${ui.container} ${styles.pageFooter}`}><span>GWStore</span><Link href="/">Ver catálogo</Link><Link href="/minhas-compras">Minhas compras</Link></footer>
  </div>;
}

function SupportContact({ info }: { info: ShopInformation }) {
  return <section className={styles.contactCard}><h2>Fale com a GWStore</h2>
    {info.supportUrl ? <><p>Use este canal para tirar dúvidas antes de comprar, pedir ajuda com acesso, pagamentos, cancelamento ou privacidade.</p>
      <a href={info.supportUrl} className={ui.secondaryButton} rel="noreferrer">{info.supportLabel}</a></> :
      <p>Se você já pagou, abra sua compra para conversar com a equipe.</p>}
    <p><Link href="/minhas-compras">Abrir minhas compras e atendimento</Link></p>
    {info.hours ? <p>Horário de atendimento: {info.hours} (horário de Brasília).</p> : null}
    <p>Ao pedir ajuda sobre uma compra, informe o número do pedido e descreva o que aconteceu. Evite enviar senhas, códigos de acesso ou dados bancários completos.</p>
  </section>;
}

function SupportContent({ info }: { info: ShopInformation }) {
  return <>
    <h2>Como a entrega funciona</h2><ol><li>Escolha o produto, confira sua descrição e os requisitos e monte o carrinho.</li>
      <li>Entre na sua conta e informe o nome de usuário correto do Roblox. Confira os itens, quantidades e o valor antes de pagar.</li>
      <li>Depois da confirmação do Pix, abra o pedido em <Link href="/minhas-compras">Minhas compras</Link>. O chat privado conecta você à equipe para realizar a entrega.</li></ol>
    <p>A entrega é manual. A aprovação do pagamento abre o atendimento; ela não significa que o item já foi entregue ou que o serviço foi concluído.</p>
    <h2>Prazos e disponibilidade</h2>
    <dl><dt>Itens digitais</dt><dd>{info.digitalDelivery || "Confirme o prazo com a equipe antes de pagar."}</dd>
      <dt>Serviços de UP</dt><dd>{info.serviceDelivery || "O prazo depende do serviço e dos requisitos da conta. Confirme com a equipe antes de pagar."}</dd>
      <dt>Robux</dt><dd>{info.robuxDelivery || "Consulte a equipe sobre a modalidade de entrega e o prazo antes de pagar."}</dd>
      {info.hours ? <><dt>Atendimento</dt><dd>{info.hours} (Brasília)</dd></> : null}</dl>
    <p>Em serviços de UP, leia os requisitos mostrados no produto e no carrinho. O andamento e as orientações ficam registrados no chat da compra.</p>
    <h2>Meu Pix ainda não apareceu</h2><p>Abra o pedido para acompanhar a confirmação. O comprovante e o retorno à loja não aprovam o pagamento por conta própria. Se você já pagou, peça ajuda antes de gerar ou pagar outro Pix.</p>
    <p>Não pague um código vencido. Para dúvidas sobre cancelamento, consulte <Link href="/reembolsos">cancelamento e reembolso</Link>.</p>
  </>;
}

function TermsContent() {
  return <>
    <h2>Produtos e pedidos</h2><p>A GWStore comercializa itens e serviços digitais descritos no catálogo. Confira nome, quantidade, preço, estoque e requisitos antes da compra. Cada pedido aceita até cinco produtos diferentes. A disponibilidade e o valor final são conferidos novamente no servidor.</p>
    <h2>Conta e identificação no jogo</h2><p>Use um método de acesso disponível na tela de entrada e uma conta que você possa acessar novamente. As compras ficam vinculadas a essa conta. Informe seu nome de usuário do Roblox, que pode ser diferente do nome de exibição.</p>
    <h2>Pagamento e entrega</h2><p>O pagamento é feito via Pix pelos provedores apresentados no checkout. A compra só é aprovada após a confirmação do provedor. A entrega é realizada pela equipe no chat privado; confira os <Link href="/atendimento">prazos e canais de atendimento</Link> antes de pagar.</p>
    <h2>Ajuda e cancelamento</h2><p>Problemas de pagamento, entrega ou acesso podem ser apresentados ao suporte. Consulte os meios para <Link href="/reembolsos">solicitar cancelamento ou reembolso</Link>. Estas informações não afastam direitos previstos na legislação de consumo.</p>
    <h2>Dados da compra</h2><p>A <Link href="/privacidade">política de privacidade</Link> explica os dados usados para autenticação, processamento do pedido e atendimento.</p>
    <p>A GWStore é uma loja independente. As marcas e nomes dos jogos identificam os produtos e não indicam vínculo oficial com seus titulares.</p>
  </>;
}

function PrivacyContent() {
  return <>
    <h2>Dados usados pela loja</h2><p>Usamos a identificação da sua conta, nome e avatar disponibilizados pelo provedor de acesso, e-mail quando disponível, nome de usuário no Roblox, itens do pedido, valores, situação do pagamento e mensagens do atendimento. Os serviços de hospedagem e autenticação também podem registrar informações técnicas necessárias à segurança e ao funcionamento.</p>
    <h2>Para que usamos esses dados</h2><p>Os dados permitem autenticar você, associar a compra à conta correta, processar pagamentos, controlar estoque, entregar produtos, prestar suporte, prevenir fraudes e cumprir obrigações legais. Mensagens do pedido ficam acessíveis ao comprador e à equipe autorizada.</p>
    <h2>Serviços envolvidos</h2><p>Supabase fornece autenticação e armazenamento. Railway e a ponte de domínio na Vercel hospedam e encaminham a aplicação. Google ou Discord participam quando você escolhe esses métodos de acesso. LivePix ou EclipsePay processam o Pix conforme o checkout. Esses fornecedores podem tratar dados em outros países, conforme suas políticas.</p>
    <h2>Cookies e armazenamento local</h2><p>A loja utiliza cookies de sessão e de retorno de login e armazena os identificadores e quantidades do carrinho no navegador para manter sua compra durante a navegação. Você pode limpar esses dados nas configurações do navegador; isso pode encerrar a sessão e apagar o carrinho local.</p>
    <h2>Seus direitos</h2><p>Use o contato de suporte para solicitar informações, acesso, correção ou exclusão de dados. Alguns registros precisam ser conservados para obrigações legais, segurança ou exercício de direitos; a solicitação é avaliada conforme a finalidade e a legislação aplicável.</p>
    <p>Referência: <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm" rel="noreferrer">Lei Geral de Proteção de Dados Pessoais</a>.</p>
  </>;
}

function RefundContent() {
  return <>
    <h2>Como solicitar</h2><p>Use o chat da sua compra em <Link href="/minhas-compras">Minhas compras</Link> ou o contato de suporte abaixo. Informe o número do pedido e se deseja cancelar, corrigir um problema ou pedir reembolso. Se não conseguir acessar a conta, use o canal de suporte para recuperar o atendimento.</p>
    <h2>Pedido ainda não pago</h2><p>Não realize o Pix de uma compra que você não deseja concluir. Respeite o vencimento mostrado no pagamento. Se já pagou, procure a equipe para verificar a situação antes de iniciar outra compra.</p>
    <h2>Arrependimento e problemas de entrega</h2><p>O consumidor pode exercer o direito de arrependimento em sete dias, contados da assinatura ou do recebimento do produto ou serviço, nos termos do art. 49 do Código de Defesa do Consumidor. A natureza digital do produto, por si só, não elimina os direitos previstos em lei.</p>
    <p>Item incorreto, entrega não realizada, pagamento duplicado ou pagamento após o vencimento devem ser informados ao suporte. A equipe verifica o pedido e orienta sobre correção, cancelamento e devolução dos valores quando cabível.</p>
    <h2>Acompanhamento da solicitação</h2><p>A solicitação de reembolso é tratada pela equipe; enviar uma mensagem não executa um estorno automático. Guarde o número do pedido e o histórico da conversa para acompanhar a resolução. Nunca envie senhas ou códigos de autenticação para solicitar reembolso.</p>
    <p>Referências: <a href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm" rel="noreferrer">Código de Defesa do Consumidor</a> e <a href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm" rel="noreferrer">Decreto do comércio eletrônico</a>.</p>
  </>;
}
