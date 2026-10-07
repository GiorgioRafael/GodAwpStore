/** GWStore UP prices supplied by the store owner. Each quantity is a package, never a raw level/beli amount. */
export const GW_UP_GUILD_ID = "1401264061101899820";
export const GW_UP_CHANNEL_ID = "1492332216410439882";
export const GW_UP_STORE_ID = "0b0e91fe-d7ba-5257-845d-7e78a9187d4a";
export const GW_UP_ENTRY_TITLE = "🔥 GW STORE — SERVIÇOS DE UP";
export type UpServiceDefinition = { id: string; name: string; priceCents: number; requirements: string; unit: string };
export type UpCategoryDefinition = { key: string; id: string; name: string; emoji: string; services: UpServiceDefinition[] };
export const GW_UP_CATEGORIES: UpCategoryDefinition[] = [
  {
    "key": "geral",
    "id": "bdc4b6f0-da98-58b6-9c33-ea16139723e8",
    "name": "UP geral",
    "emoji": "📈",
    "services": [
      {
        "id": "847545e9-cb9b-50db-bffd-237334e865f4",
        "name": "Level · 100 níveis",
        "priceCents": 200,
        "requirements": "Informe o nível atual e o nível desejado no atendimento.",
        "unit": "100 níveis"
      },
      {
        "id": "925e7523-2505-58af-9ed1-765f02f64a96",
        "name": "Beli · 1M",
        "priceCents": 200,
        "requirements": "",
        "unit": "1M de Beli"
      },
      {
        "id": "810d1ac3-e115-5797-b742-d0d7aa2163a9",
        "name": "Maestria · 100 pontos",
        "priceCents": 200,
        "requirements": "Informe a arma, fruta ou estilo desejado no atendimento.",
        "unit": "100 de maestria"
      },
      {
        "id": "8c94592d-e2cb-5dea-ade4-e8c4444b3dde",
        "name": "Fragmentos · 1K",
        "priceCents": 200,
        "requirements": "",
        "unit": "1K de fragmentos"
      },
      {
        "id": "e9f38e99-bb43-535d-8f35-5b3c4ae8ed8e",
        "name": "Bounty · 1M",
        "priceCents": 1000,
        "requirements": "",
        "unit": "1M de bounty"
      }
    ]
  },
  {
    "key": "estilos",
    "id": "1488a262-d174-542d-8a0a-a4ebdf39a13d",
    "name": "Estilos de luta",
    "emoji": "🥋",
    "services": [
      {
        "id": "9e715cb9-b657-51d6-86ab-096810642dfb",
        "name": "SuperHuman",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "ae326732-0e27-5378-b6e9-d241f986b330",
        "name": "Death Step",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "8cba30d1-fa77-5413-84f1-df2e84c078c5",
        "name": "Sharkman Karate",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "7f660a67-9d13-5905-8559-f7285d486b93",
        "name": "Electric Claw",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "5b14bd80-6aee-5fe7-be73-1f20bed7c209",
        "name": "Dragon Talon",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "077e81db-b898-5e41-a04b-3256e8e8c308",
        "name": "God Human",
        "priceCents": 5000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "143bd4fa-3132-59f3-8827-a01ce67a541f",
        "name": "Sanguine Art · coração + materiais",
        "priceCents": 5000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "16c05fc4-ca55-5c25-b7de-1c304fc57075",
        "name": "Somente materiais do Sanguine",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "espadas",
    "id": "ea27fea1-f4b1-5143-916b-8db6acf808f3",
    "name": "Espadas",
    "emoji": "⚔️",
    "services": [
      {
        "id": "f3f37436-75cd-55cf-9de0-deef38afaa55",
        "name": "CDK",
        "priceCents": 1500,
        "requirements": "É necessário possuir Yama + Tushita.",
        "unit": "serviço"
      },
      {
        "id": "498dd095-3c1b-5e32-adf4-6631572a5dcf",
        "name": "Tushita",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "164e7264-2558-5773-a7fc-acdfc0505c2c",
        "name": "Yama",
        "priceCents": 500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "51420290-4666-5bff-afcc-7644f64c2b9f",
        "name": "TTK",
        "priceCents": 3000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "e474f9a3-ebd7-5d7e-a7da-3b7a85743af1",
        "name": "TTK com 2x Maestria",
        "priceCents": 2000,
        "requirements": "É necessário possuir 2x Maestria.",
        "unit": "serviço"
      },
      {
        "id": "039feeda-ce61-5501-a524-750d9e32df85",
        "name": "Cada espada da TTK",
        "priceCents": 800,
        "requirements": "Informe qual espada deseja no atendimento.",
        "unit": "espada"
      },
      {
        "id": "008f4353-7731-5f80-8431-8f0a699dfdfa",
        "name": "Mini Yoru",
        "priceCents": 4000,
        "requirements": "É obrigatório possuir os Hakis necessários.",
        "unit": "serviço"
      },
      {
        "id": "8e561b60-488d-55e7-99ec-1664655becdd",
        "name": "Mini Yoru com 2x Drop",
        "priceCents": 2500,
        "requirements": "É obrigatório possuir os Hakis necessários e 2x Drop.",
        "unit": "serviço"
      },
      {
        "id": "d17c09b1-4d9f-5e0f-9354-27736bdc613e",
        "name": "Foice Sagrada",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "3ee3d8ff-95aa-534d-9f59-c6b220362186",
        "name": "Spikey Trident",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "444d4a62-9749-5082-90af-ddc6eec9668b",
        "name": "Pole V1 + V2",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "6fc1bcfa-619d-55a8-9b66-06790528d0de",
        "name": "Shark Anchor",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "9866833b-8807-5f80-8fc6-327bb62fe75a",
        "name": "Fox Lamp",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "e9aa09b2-2a82-543c-8d71-1116591f0a03",
        "name": "Dragon Heart",
        "priceCents": 2000,
        "requirements": "É obrigatório possuir Draco.",
        "unit": "serviço"
      },
      {
        "id": "d0cb1b75-131f-5eba-a932-173b28233454",
        "name": "Yoru V2",
        "priceCents": 2000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "60081563-7917-56f3-9c7f-796866d79875",
        "name": "Yoru V3",
        "priceCents": 4000,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "armas",
    "id": "097ae642-68a1-5495-a716-6660d294801b",
    "name": "Armas",
    "emoji": "🔫",
    "services": [
      {
        "id": "5e939a4b-dd6a-59e1-82ad-419bd6d8b9ba",
        "name": "Dragon Storm",
        "priceCents": 2500,
        "requirements": "É obrigatório possuir Draco.",
        "unit": "serviço"
      },
      {
        "id": "46e7eeb4-66b9-546e-8422-19b2c1a70e58",
        "name": "Soul Guitar completa",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "29920d96-2260-5026-873e-993ecc410a7f",
        "name": "Missão da Soul Guitar",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "4eadb43d-5419-5281-9a9e-c65f88a10d45",
        "name": "Materiais da Soul Guitar",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "racas",
    "id": "f6e82506-17c8-5daf-9ba1-049ea2ae8202",
    "name": "Raças até V3",
    "emoji": "🧬",
    "services": [
      {
        "id": "33b44da1-0d22-5388-ab1c-c2c7ef0609bf",
        "name": "Desbloquear Ghoul",
        "priceCents": 2500,
        "requirements": "Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.",
        "unit": "serviço"
      },
      {
        "id": "43f36173-b3fc-5b12-bbe4-5f5aeef1aad3",
        "name": "Desbloquear Cyborg",
        "priceCents": 4000,
        "requirements": "Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.",
        "unit": "serviço"
      },
      {
        "id": "a22e7941-a571-56ce-aad1-25e177253a8a",
        "name": "1 raça até V3",
        "priceCents": 1500,
        "requirements": "Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.",
        "unit": "serviço"
      },
      {
        "id": "50124bde-7100-5416-a2a4-9ed63b6c5559",
        "name": "3 raças até V3",
        "priceCents": 2500,
        "requirements": "Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.",
        "unit": "serviço"
      },
      {
        "id": "53fc498e-6519-53f3-a243-b5b3534bffed",
        "name": "6 raças até V3",
        "priceCents": 5000,
        "requirements": "Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "v4",
    "id": "8466def7-6971-5d2a-8224-d910124345a4",
    "name": "Raças V4",
    "emoji": "⚙️",
    "services": [
      {
        "id": "e443ec71-d7e6-5d21-b327-8bc5e31b94b3",
        "name": "1 Engrenagem V4",
        "priceCents": 1500,
        "requirements": "Não inclui Draco. É necessário possuir a raça no V3 e os fragmentos necessários.",
        "unit": "engrenagem"
      },
      {
        "id": "646ef3f9-ef00-5884-a90f-3e5dc64d02fb",
        "name": "1 Raça V4 Full",
        "priceCents": 3000,
        "requirements": "Não inclui Draco. É necessário possuir as raças escolhidas no V3 e os fragmentos necessários.",
        "unit": "serviço"
      },
      {
        "id": "89af8fde-4530-5366-a3b9-0ab8c704d506",
        "name": "2 Raças V4 Full",
        "priceCents": 5000,
        "requirements": "Não inclui Draco. É necessário possuir as raças escolhidas no V3 e os fragmentos necessários.",
        "unit": "serviço"
      },
      {
        "id": "437f3ce5-1abc-54cf-9be5-3d22346e6e9b",
        "name": "3 Raças V4 Full",
        "priceCents": 8000,
        "requirements": "Não inclui Draco. É necessário possuir as raças escolhidas no V3 e os fragmentos necessários.",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "draco",
    "id": "7390a86e-86d9-5bb5-8d93-686b713b35dc",
    "name": "Raça Draco",
    "emoji": "🐉",
    "services": [
      {
        "id": "ace095f0-6617-5782-b796-1fe53237cd32",
        "name": "Faixa Preta",
        "priceCents": 2000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "f117f481-1e2c-5d18-9a48-f952936713ea",
        "name": "Todas as Faixas + Raça Draco",
        "priceCents": 5000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "2840192e-cd80-5ca8-8d7a-8457f44c282c",
        "name": "Somente desbloquear Draco",
        "priceCents": 2000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "a20c3516-9163-521b-a103-c0e4a5e7b236",
        "name": "Draco V2",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "2939e126-9d0c-5207-8013-ac625f244149",
        "name": "Draco V3",
        "priceCents": 2000,
        "requirements": "Rainbow Haki obrigatório para V3.",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "pacotes-draco",
    "id": "248372a2-153b-5278-9dee-c9988529354d",
    "name": "Pacotes Draco",
    "emoji": "🔥",
    "services": [
      {
        "id": "d0d00913-2737-5cf4-9d13-735081f96492",
        "name": "Das Faixas até V3",
        "priceCents": 7000,
        "requirements": "Rainbow Haki obrigatório para V3.",
        "unit": "serviço"
      },
      {
        "id": "d3147f3a-f9e8-54a3-8343-ed97bcb4b98b",
        "name": "Da Raça até V3",
        "priceCents": 3500,
        "requirements": "Rainbow Haki obrigatório para V3.",
        "unit": "serviço"
      },
      {
        "id": "b4f07c7a-338e-5e8c-92cf-a8b3bf96f369",
        "name": "Cada Engrenagem Draco V4",
        "priceCents": 1500,
        "requirements": "",
        "unit": "engrenagem"
      },
      {
        "id": "13af7087-22c5-5efb-84f7-10e9b105cbed",
        "name": "Draco V4 Full · sem Hydra",
        "priceCents": 10000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "19f1bd75-ed46-517d-adc6-bf1f8663678c",
        "name": "Draco V4 Full · com Hydra",
        "priceCents": 12000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "14802bde-e215-5a0a-b892-da7501c18a52",
        "name": "V4 Full + Hydra + Armas",
        "priceCents": 15000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "09ef5565-9e91-513f-abb8-fdba6dc6073c",
        "name": "Das Faixas até V4 Full",
        "priceCents": 17000,
        "requirements": "Inclui arma + espada Draco. Rainbow Haki obrigatório para V3.",
        "unit": "serviço"
      },
      {
        "id": "5a7d22ee-3f6e-58bb-b2bb-e016155533dd",
        "name": "Congelar Hydra",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "ilhas",
    "id": "6f2fe74d-ad43-5871-9d88-b237c0b4eea8",
    "name": "Ilhas",
    "emoji": "🏝️",
    "services": [
      {
        "id": "a63d92bd-3372-5428-ab10-111d454bb194",
        "name": "Mirage Island",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "134b1ba6-5144-5f01-8d29-89ef59a1a696",
        "name": "Kitsune Island",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "f2f55e67-04fa-54a6-bb40-30a4b26bae15",
        "name": "Pré-Historic Island",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "bosses",
    "id": "18fceb1e-91f0-5d90-a51f-534c68395d88",
    "name": "Bosses",
    "emoji": "👹",
    "services": [
      {
        "id": "9dd88b58-7419-5ba3-b474-32659c5dacdd",
        "name": "Rip Indra com Haki",
        "priceCents": 1000,
        "requirements": "É necessário possuir os Hakis.",
        "unit": "serviço"
      },
      {
        "id": "7c1f1d19-b5fa-5e56-a187-aaa7b579f7f6",
        "name": "Rip Indra sem Haki",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "277e2da7-2c51-52ff-afb2-dec3d672a228",
        "name": "Dough King",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "a758f265-0551-5a65-80ea-c38c8e51758b",
        "name": "1 Fragmento Negro",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "bc36e045-e9b5-56d7-9bc3-521526314355",
        "name": "2 Fragmentos Negros",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "322196fd-f2c6-5a99-9ec9-f1c721623c03",
        "name": "3 Fragmentos Negros",
        "priceCents": 2000,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "leviata",
    "id": "2e290afe-9a6b-5dc1-b84e-b23ab28591a8",
    "name": "Leviatã",
    "emoji": "🌊",
    "services": [
      {
        "id": "b7c2b2be-05b6-5db4-b6da-0cbcb54a53d9",
        "name": "Coroa do Leviatã",
        "priceCents": 4000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "af9cf7a3-e393-5676-b2bc-715ae7928f97",
        "name": "Escudo do Leviatã",
        "priceCents": 5000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "38ade575-b1c7-5fd0-8eb7-b7d1b7848dc0",
        "name": "Retirar Cooldown",
        "priceCents": 500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "9ea760a1-873a-57ec-bcc2-cbecc1e03219",
        "name": "Barco do Leviatã",
        "priceCents": 3000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "69b0d785-3272-53dd-9883-64f76cf86637",
        "name": "Congelar Hydra",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "d65e1c26-9b26-5e99-87ae-ba5d4c453b2d",
        "name": "Coração do Leviatã",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "f1cec840-1f7b-53d4-b79e-90eb018b45e1",
        "name": "2 Leviatãs",
        "priceCents": 5000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "4f89ea34-2136-5b5f-afac-28932b746842",
        "name": "5 Leviatãs",
        "priceCents": 10000,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  },
  {
    "key": "hakis",
    "id": "3bf1f0a1-14aa-5fc0-87c7-b7a86830998e",
    "name": "Hakis",
    "emoji": "✨",
    "services": [
      {
        "id": "07ff2759-1eb5-57bc-9ac2-b5ff7d0411bd",
        "name": "Rainbow Haki",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "4f2b8bcb-1bf9-50ce-bf8a-298a090933f9",
        "name": "Cada Haki Lendário",
        "priceCents": 1500,
        "requirements": "Informe a cor desejada no atendimento.",
        "unit": "Haki"
      }
    ]
  },
  {
    "key": "observacao",
    "id": "cdb0ec36-b566-5aa7-b41d-266453496fe7",
    "name": "Haki da observação",
    "emoji": "👁️",
    "services": [
      {
        "id": "848107a8-3ba7-5ce5-a3a2-963b86e06c17",
        "name": "100 Desvios",
        "priceCents": 200,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "a2d56e8c-7354-559e-92a6-e227338d70df",
        "name": "500 Desvios",
        "priceCents": 1000,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "96129dc2-ec7f-554f-a863-cc4575c5018f",
        "name": "1.000 Desvios",
        "priceCents": 1500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "51a25c03-f03c-5c8c-b004-186cba2fafbf",
        "name": "2.000 Desvios",
        "priceCents": 2500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "3482a6f1-164d-5d8f-8b2d-d337708ea3f1",
        "name": "3.000 Desvios",
        "priceCents": 3500,
        "requirements": "",
        "unit": "serviço"
      },
      {
        "id": "8bc52e51-68c9-5646-98b5-bba5a363916b",
        "name": "5.000 Desvios",
        "priceCents": 4000,
        "requirements": "",
        "unit": "serviço"
      }
    ]
  }
];
export function findUpService(id: string) {
  for (const category of GW_UP_CATEGORIES) {
    const service = category.services.find(item => item.id === id);
    if (service) return { ...service, categoryKey: category.key };
  }
  return null;
}
export function upServiceDescription(service: UpServiceDefinition) {
  return `Quantidade = pacotes de ${service.unit}. ${service.requirements || "Confira com a equipe os detalhes de execução no atendimento."}`;
}
