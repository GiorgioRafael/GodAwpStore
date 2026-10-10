import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShopMessage, ShopOrderStatus } from "@/lib/shop/types";
import { ShopOrderWorkspace } from "./order-workspace";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,dGVzdA==") } }));

const ORDER_ID = "10000000-0000-4000-8000-000000000001";
const BASE = `/api/loja/pedidos/${ORDER_ID}`;
const PAID_AT = "2026-10-09T12:00:00.000Z";
const BASE_ORDER: ShopOrderStatus = {
  orderId: ORDER_ID, status: "paid", paymentStatus: "paid", totalPriceCents: 5_500,
  checkoutUrl: null, ticketUrl: null, chatUrl: `/minhas-compras/${ORDER_ID}`,
  gameNickname: "Buyer_123", createdAt: "2026-10-09T11:55:00.000Z", paidAt: PAID_AT,
  deliveredAt: null, paymentExpiresAt: null, pixCode: null, buyerName: "Ana",
  items: [{ productName: "Dragon West", quantity: 1, unitPriceCents: 5_500, totalPriceCents: 5_500 }],
};
const message = (body: string, extras: Partial<ShopMessage> = {}): ShopMessage => ({
  id: "20000000-0000-4000-8000-000000000002", body, authorRole: "buyer", authorName: "Ana", createdAt: PAID_AT, ...extras,
});
let order: ShopOrderStatus;
let chat: { messages: ShopMessage[]; canSend: boolean; deliveredAt: string | null };
const request = vi.fn();
const postMessage = vi.fn();
const postDelivery = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const postCalls = (path: string) => request.mock.calls.filter(([url, init]) => url === path && init?.method === "POST");

beforeEach(() => {
  order = { ...BASE_ORDER };
  chat = { messages: [], canSend: true, deliveredAt: null };
  request.mockReset(); postMessage.mockReset(); postDelivery.mockReset();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  postMessage.mockImplementation(async () => json({ ok: true }));
  postDelivery.mockImplementation(async () => json({ ok: true }));
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === `${BASE}/mensagens` && init?.method === "POST") return postMessage(init);
    if (url === `${BASE}/entrega` && init?.method === "POST") return postDelivery(init);
    if (url === BASE) return json({ ok: true, ...order });
    if (url === `${BASE}/mensagens`) return json({ ok: true, ...chat });
    throw new Error("Unexpected test request");
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("atendimento privado das compras", () => {
  it("aguarda o pagamento sem buscar mensagens e abre o atendimento quando o Pix é confirmado", async () => {
    order = { ...order, status: "awaiting_payment", paymentStatus: "pending", paidAt: null, checkoutUrl: "https://pay.example/order" };
    render(<ShopOrderWorkspace orderId={ORDER_ID} />);
    expect(await screen.findByRole("heading", { name: "Seu chat abre após o pagamento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagar com Pix" })).toHaveAttribute("href", "https://pay.example/order");
    expect(screen.queryByRole("textbox", { name: "Sua mensagem" })).not.toBeInTheDocument();
    expect(request.mock.calls.some(([url]) => url === `${BASE}/mensagens`)).toBe(false);
    order = { ...order, status: "paid", paymentStatus: "paid", paidAt: PAID_AT };
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled());
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pagar com Pix" })).not.toBeInTheDocument();
    expect(request.mock.calls.some(([url]) => url === `${BASE}/mensagens`)).toBe(true);
  });

  it("mantém histórico privado após reembolso usando a data de pagamento anterior", async () => {
    order = { ...order, status: "refunded", paymentStatus: "refunded", paidAt: PAID_AT };
    chat = { messages: [message("Seu reembolso foi confirmado.", { authorRole: "staff" })], canSend: false, deliveredAt: null };
    render(<ShopOrderWorkspace orderId={ORDER_ID} admin />);
    expect(await screen.findByText("Seu reembolso foi confirmado.")).toBeInTheDocument();
    expect(screen.getByText("Reembolsado")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Concluir entrega" })).not.toBeInTheDocument();
  });

  it("não oferece ao comprador o controle administrativo de entrega", async () => {
    render(<ShopOrderWorkspace orderId={ORDER_ID} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Concluir entrega" })).not.toBeInTheDocument();
    expect(screen.queryByText("Comprador: Ana")).not.toBeInTheDocument();
    expect(postCalls(`${BASE}/entrega`)).toHaveLength(0);
  });

  it("pede confirmação ao administrador e só mostra entrega concluída após o servidor confirmar", async () => {
    const user = userEvent.setup();
    postDelivery.mockImplementation(async () => {
      order = { ...order, status: "delivered", deliveredAt: "2026-10-09T12:10:00.000Z" };
      chat = { messages: [message("Entrega concluída.", { authorRole: "system" })], canSend: false, deliveredAt: order.deliveredAt };
      return json({ ok: true, ...order });
    });
    render(<ShopOrderWorkspace orderId={ORDER_ID} admin />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Concluir entrega" }));
    const confirm = screen.getByRole("dialog", { name: "Concluir entrega" });
    expect(within(confirm).getByText(/depois de entregar todos os itens/)).toBeInTheDocument();
    expect(postCalls(`${BASE}/entrega`)).toHaveLength(0);
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Confirmar entrega" }));
    expect(await screen.findByText("Entregue")).toBeInTheDocument();
    expect(postCalls(`${BASE}/entrega`)).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Concluir entrega" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeDisabled();
    expect(screen.getByText("Entrega concluída. O histórico fica salvo nesta compra.")).toBeInTheDocument();
  });

  it("mantém compra paga e cancelada visível para análise sem permitir conclusão indevida", async () => {
    order = { ...order, status: "cancelled" };
    chat.messages = [message("O Pix foi pago após expirar. Preciso de atendimento.")];
    render(<ShopOrderWorkspace orderId={ORDER_ID} admin />);
    expect(await screen.findByText("O Pix foi pago após expirar. Preciso de atendimento.")).toBeInTheDocument();
    expect(screen.getByText("Análise necessária")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Concluir entrega" })).not.toBeInTheDocument();
    expect(postCalls(`${BASE}/entrega`)).toHaveLength(0);
  });

  it("não simula entrega nem encerra o chat quando a conclusão falha", async () => {
    const user = userEvent.setup();
    postDelivery.mockResolvedValue(json({ ok: false, error: { message: "Não foi possível concluir a entrega." } }, 503));
    render(<ShopOrderWorkspace orderId={ORDER_ID} admin />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Concluir entrega" }));
    await user.click(screen.getByRole("button", { name: "Confirmar entrega" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir a entrega.");
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.queryByText("Entregue")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Concluir entrega" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Sua mensagem" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Confirmar entrega" })).toBeEnabled();
  });

  it("exibe mensagens e nomes como texto e limita novas mensagens a 2000 caracteres", async () => {
    const user = userEvent.setup();
    const unsafe = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    chat.messages = [message(unsafe, { authorName: "<b>Ana</b>" }), message("<a href=javascript:alert(1)>Aviso</a>", { id: "system", authorRole: "system" })];
    render(<ShopOrderWorkspace orderId={ORDER_ID} />);
    expect(await screen.findByText(unsafe)).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Mensagens do atendimento" });
    expect(within(log).getByText("<b>Ana</b>")).toBeInTheDocument();
    expect(log.querySelector("img,script,a,b")).toBeNull();
    const composer = screen.getByRole("textbox", { name: "Sua mensagem" });
    expect(composer).toHaveAttribute("maxlength", "2000");
    await user.click(composer);
    await user.paste("a".repeat(2005));
    expect(composer).toHaveValue("a".repeat(2000));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("preserva o rascunho e a chave de envio após falha sem duplicar a tentativa", async () => {
    const user = userEvent.setup();
    postMessage.mockRejectedValueOnce(new Error("network"));
    postMessage.mockImplementation(async (init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      chat.messages = [message(input.body)];
      return json({ ok: true, message: chat.messages[0] });
    });
    render(<ShopOrderWorkspace orderId={ORDER_ID} />);
    const composer = await screen.findByRole("textbox", { name: "Sua mensagem" });
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "  Olá, já paguei.  ");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A mensagem não foi confirmada");
    expect(composer).toHaveValue("  Olá, já paguei.  ");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Olá, já paguei.")).toBeInTheDocument();
    await waitFor(() => expect(composer).toHaveValue(""));
    const calls = postCalls(`${BASE}/mensagens`);
    expect(calls).toHaveLength(2);
    const first = JSON.parse(calls[0][1].body);
    expect(first).toEqual({ body: "Olá, já paguei.", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(JSON.parse(calls[1][1].body)).toEqual(first);
    expect(first).not.toHaveProperty("authorRole");
  });
});
