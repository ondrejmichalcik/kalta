# Kalta – Project Context for Claude Code

Tento soubor se automaticky načítá do každé session. Obsahuje klíčový kontext — delší detaily jsou v `.claude/` souborech, které si podle potřeby vyžádáš.

---

## Co Kalta je

iOS appka pro evidenci nouzových zásob (prepper supplies) v fyzických bednách se QR kódy.

**Hlavní flow:**
1. Uživatel vytvoří bednu → appka vygeneruje QR štítek → přilepí na bednu
2. Naskenuje EAN produktů → appka prefillne z Open Food Facts → user doplní datum expirace → uloží
3. Appka hlídá expirace, seřazuje bedny podle urgence, posílá push notifikace
4. Sklad lze sdílet s manželkou přes Apple Sign In

**Uživatelé:** 2 (tvůrce + manželka), distribuce přes TestFlight, ne App Store.

---

## Tech stack (stručně)

- **Frontend:** Expo 51, React Native 0.74, TypeScript, Expo Router (file-based)
- **Backend:** Supabase (Postgres + Realtime + Auth + Storage)
- **Auth:** Apple Sign In přes native ID token flow (vyžaduje Apple Developer Program)
- **Kamera/QR:** `expo-camera` CameraView s barcode scanning
- **Produktová DB:** Open Food Facts (zdarma, ~85% EU potravin)
- **AI (Sprint 3):** Anthropic Claude Vision přes Supabase Edge Function
- **Tisk štítků (Sprint 3):** Niimbot B21 přes `react-native-ble-plx`
- **Push (Sprint 4):** `expo-notifications` + Supabase Edge Function cron

Detailní technologická rozhodnutí a zdůvodnění → **[`.claude/tech-decisions.md`](.claude/tech-decisions.md)**

---

## Struktura projektu

```
stockr/
├── CLAUDE.md                     ← tento soubor
├── .claude/
│   ├── tech-decisions.md         ← proč jsme použili co a jaké alternativy jsme zvážili
│   ├── implementation-plan.md    ← sprint plán, co je hotové, co zbývá
│   └── test-scenarios.md         ← testovací scénáře pro key flows
├── supabase/
│   └── schema.sql                ← celé DB schéma + RLS + triggery (spustit v Supabase SQL Editoru)
├── modules/
│   └── stockr-multipeer/                             ← custom Expo native modul pro MultipeerConnectivity P2P sync
│       ├── ios/KaltaMultipeerModule.swift            ← MCSession + advertiser + browser
│       ├── ios/KaltaMultipeer.podspec
│       ├── expo-module.config.json
│       └── src/index.ts                              ← JS API: startSession, invitePeer, sendData, events
├── src/
│   ├── types/database.ts         ← TS typy + domain utility (getExpiryStatus, formatExpiry, …)
│   ├── lib/
│   │   ├── supabase.ts           ← Supabase klient + API (SQLite-first s Supabase fallback)
│   │   ├── localDb.ts            ← SQLite schema + singleton connection
│   │   ├── localQueries.ts       ← SQLite read functions (12 queries)
│   │   ├── localWrites.ts        ← SQLite write operations + sync queue
│   │   ├── sync.ts               ← Bidirectional sync engine (push/pull/conflicts)
│   │   ├── p2pSync.ts            ← P2P data export/import s last-write-wins merge
│   │   ├── imageCache.ts         ← Offline image cache (SHA-256 → local .jpg)
│   │   ├── notifications.ts      ← Local expiry notifications scheduling
│   │   ├── useNetworkStatus.ts   ← Network connectivity hook
│   │   └── openFoodFacts.ts      ← EAN lookup + mapování kategorií
│   └── components/
│       ├── ItemEditSheet.tsx     ← modal pro edit položky
│       ├── BoxEditSheet.tsx      ← modal pro edit bedny
│       └── SyncStatusBar.tsx     ← global offline/syncing/conflicts indicator
├── app/                                          ← Expo Router file-based routing
│   ├── _layout.tsx                               ← root, auth guard, deep link handler, session persistence, notification tap handler
│   ├── +native-intent.tsx                        ← deep link rewriting (invite URL → root)
│   ├── +not-found.tsx                            ← catch-all redirect
│   ├── invite/[token].tsx                        ← invite deep link route (processes invitation)
│   ├── (auth)/
│   │   └── login.tsx                             ← Apple Sign In + "Continue offline" button
│   └── (app)/
│       ├── _layout.tsx                           ← stack navigator + SyncStatusBar
│       ├── index.tsx                             ← Warehouses list (root) — empty state, pill cards, profile icon, FAB
│       ├── conflicts.tsx                         ← Sync conflict resolution (per-field local vs server)
│       ├── p2p-sync.tsx                          ← P2P sync via MultipeerConnectivity
│       └── warehouse/
│           ├── new.tsx                           ← Create warehouse form
│           └── [warehouseId]/
│               ├── (tabs)/
│               │   ├── _layout.tsx               ← 4-tab layout per warehouse
│               │   ├── index.tsx                 ← Boxes list (Dashboard)
│               │   ├── items.tsx                 ← Cross-box items timeline (sort opened-first)
│               │   ├── scan.tsx                  ← QR scanner → box detail
│               │   └── settings.tsx              ← Warehouse settings (rename, members, invite, delete/leave)
│               └── box/
│                   ├── new.tsx                   ← vytvoření bedny + QR náhled
│                   ├── [boxId].tsx               ← detail bedny (list/grid, swipe: left=Open / right=Delete)
│                   └── [boxId]/add-items.tsx     ← batch naskladňovací session
├── app.json                       ← Expo config, permissions, deep link scheme
├── package.json
├── tsconfig.json                  ← @/* alias na root
├── babel.config.js                ← reanimated plugin
└── .env                           ← EXPO_PUBLIC_SUPABASE_URL + PUBLISHABLE_KEY (gitignored)
```

---

## Konvence

### Jazyk
- **UI strings anglicky** (labely, alerty, placeholdery, tlačítka, error messages, toasty) — projekt přešel na EN ve Sprintu 2.5
- **Doménové termíny anglicky v kódu i UI:** `box` (ne bedna), `warehouse` (ne sklad), `add items` (ne naskladnit), `item` (ne položka), `expiry` (ne expirace)
- **DB schema, TS types, function names anglicky** — už je
- **Komentáře v kódu anglicky**
- **Komunikace se userem v chatu zůstává česky** — jen UI a kód jsou EN
- **Date format** — zachován původní (DD. MM. YYYY), funkce přejmenovaná z `formatDateCs` na neutrální název

### Code style
- **TypeScript strict mode** zapnutý
- **No default exports** kromě Expo Router screenů (ty musí být default export)
- **Import alias:** `@/*` ukazuje na root projektu (nastaveno v `tsconfig.json`)
- **Styly:** `StyleSheet.create` na konci souboru, ne inline (kromě dynamických barev z palette)
- **Async error handling:** try/catch kolem každé Supabase/network operace, user-facing error do Alert/state
- **Žádné emoji v UI** — po Sprintu 2.5 používáme custom ikony (viz Ikonografie níže)
- **Haptic feedback** `.catch(() => {})` — nikdy neshodí UI, když zařízení nemá Taptic Engine

### Komponenty
- **Sheet modaly** pro edit flows — `Modal` s `presentationStyle="pageSheet"` pro iOS nativní swipe-down zavírání
- **ActionSheetIOS** pro context menus (nepoužívat custom dropdown)
- **Pressable** ne `TouchableOpacity` (novější API, lepší feedback via `pressed`)
- **FlatList** key prop mění při `numColumns` switch (viz `box/[id].tsx`)

### Supabase patterns
- **RLS helper funkce** `is_member(wh)` / `is_owner(wh)` místo přímých subselectů v policies (zabraňuje recursive RLS)
- **Realtime subscriptions** přes channel per entity + `filter: warehouse_id=eq.X`
- **Auth session** persistence přes `AsyncStorage` (ne `SecureStore` — Supabase klient potřebuje sync access)
- **Optimistic UI updates** pro rychlejší feedback, realtime sub to nakonec potvrdí

### Expiry status – 4 kategorie
V `src/types/database.ts`:
- `expired` – už prošlé
- `critical` – 0–30 dní
- `soon` – 30–90 dní
- `ok` – >90 dní
- `none` – bez data

Konkrétní barvy jsou v `src/theme/colors.ts` (Sprint 2.5 design system). Funkce `compareBoxesByExpiry` seřazuje bedny od expired po none, uvnitř skupiny podle data.

### Design system (po Sprintu 2.6)
- **Light-first paleta** v `src/theme/colors.ts` — subtle sage-tinted background, opaque white cards, sage green primary accent, standard iOS-like status colors
- **Dark `hero*` tokeny** zachované pro login/splash (plný dark bg s hero image)
- **Spacing / typography / radius / shadows** tokeny beze změny oproti Sprintu 2.5
- **Shadow depth** — na light bg jsou stíny vidět, proto aktivně používat `shadows.sm/md/lg` pro depth; na dark bg stíny neměly efekt
- **Nové barvy přidávat jen do palette** — pokud potřebuješ odstín, který tam není, nejdřív ověř, jestli existující token nestačí

### Ikonografie (po Sprintu 2.6)
- **SF Symbols via `expo-symbols`** — standard pro **všechny utility / chrome ikony**
  (nav chevrony, close, more, buttons, list row indicators, category icons,
  tab bar, form field icons, action sheet triggers). Native iOS rendering,
  ~5000 ikon zdarma, konzistentní s iOS systémem.
- **Custom 3D "brand" ikony** v `assets/icons/` jen pro **hero momenty**:
  login/splash background, large empty-state illustrations (80–120 px),
  onboarding a marketing screens (Sprint 4+). Zachováno 32 ikon ze Sprintu 2.5.
- **Unified `<Icon>` komponenta** s dual namespace:
  `<Icon sf="magnifyingglass" />` pro SF Symbols,
  `<Icon brand="box-generic" size={96} />` pro hero 3D PNG assety.
- **NO `@expo/vector-icons` / Ionicons** — SF Symbols jsou více iOS-native.
  (Poznámka: Kalta je iOS-only, SF Symbols nejsou Android compat.)
- Emoji v UI jen pokud jsou záměrná součást obsahu, ne jako ikony.

---

## Důležité principy pro práci na projektu

### 1. Apple Sign In vyžaduje placený Developer Program
- **$99/rok** — uživatel si ho zaplatil, ale aktivace může trvat 24–48h
- **Nefunguje v Expo Go** — potřeba `expo run:ios` (dev client)
- Alternativa pro testování bez Developer účtu: magic link (není implementováno, ale jde snadno doplnit)

### 2. TestFlight distribuce
- Jen iOS, Android se neřeší
- Single bundle ID: `com.ondrejmichalcik.kalta`
- Distribuce přes EAS Build → TestFlight (Sprint 5)

### 3. Jazyk
- **UI je anglicky** (přechod ve Sprintu 2.5 — viz sekce Konvence/Jazyk výše).
- **Komunikace se userem v chatu zůstává česky.**
- Komentáře v kódu anglicky.

### 4. Native moduly vyžadují rebuild
Sprint 2 přidal: `expo-camera`, `expo-haptics`, `expo-clipboard`, `@react-native-community/datetimepicker`, `react-native-svg`.
Sprint 4' přidal: `expo-network`, `expo-sqlite`, `expo-notifications`, `expo-document-picker`, `stockr-multipeer` (custom Expo module v `modules/`).
Každý z nich je nativní modul → při přidání nové nativní deps je nutný `eas build` nebo `npx expo run:ios`, ne jen Metro reload.

### 5. RLS je zdroj pravdy pro oprávnění
- UI zobrazuje tlačítka optimisticky (i pro member jako by mohl mazat bedny)
- Pokud RLS odmítne, Supabase vrátí prázdný výsledek / error
- Sprint 4 přidá role-aware UI (schovávat destruktivní akce pro member)
- **Do té doby: neupravuj RLS policies bez ověření, že UI to ustojí**

### 6. Sprint stav
Vývoj běží po sprintech. Detailní stav → **[`.claude/implementation-plan.md`](.claude/implementation-plan.md)**

Aktuálně: **Sprint 4' + 4 code-complete** (2026-04-18). EAS build in progress.

**Sprint 4' (offline-first) ✅**: expo-sqlite local-first data layer, bidirectional sync engine s per-field auto-merge, conflict resolution UI, global SyncStatusBar, image cache s orphan cleanup, session persistence (přežívá token expiry + sign-out recovery), MultipeerConnectivity P2P sync (custom Expo native modul `stockr-multipeer`), invite deep link fix.

**Sprint 4 (notifications) ✅**: local expiry notifications (30d/7d/1d/today configurable windows), app badge count, notification tap → box detail deep link, foreground handler.

**Next**: Sprint 5 — EAS build doběhne → TestFlight test → privacy policy + App Store metadata → Apple review submission.

---

## Odkazy do .claude/

Pokud pracuješ na:
- **Nové featuře / architektuře** → nejdřív čti `.claude/tech-decisions.md` (zjistíš, proč něco je jak je)
- **Pokračování ve sprintu** → čti `.claude/implementation-plan.md` (zjistíš, kam jsme se dostali)
- **Ověřování, že nic nerozbilo** → čti `.claude/test-scenarios.md` (zjistíš, co projít před commitem)

**Nezavádět nové konvence** bez důvodu. Pokud vidíš pattern, který se opakuje (např. sheet modaly, haptic-on-success), drž se ho.

---

## Workflow s Claude Code

- **Projekt je v aktivním vývoji** — Sprint 3 ještě neběží
- **User preferuje postupné kroky** — nedělat všechno najednou, potvrzovat si hotové části
- **User testuje na simulátoru** přes `npx expo run:ios` — většinou chce znát **rebuild vs. hot reload** každého fixu
- **Používat TaskCreate/TaskUpdate** pro sledování větších úkolů (sprinty, multi-step refaktory)
- **Po přidání native modulu vždy upozornit** na nutnost `npx expo run:ios`
- **UI držet konzistentně anglicky**; technická komunikace se userem v chatu je česky
