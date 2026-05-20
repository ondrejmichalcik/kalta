# Implementation plan – Kalta (formerly Stockr)

Živý dokument stavu vývoje. Po každém dokončeném kroku aktualizovat.

**Legenda:** ✅ hotovo · 🚧 in-progress · ⏳ pending · ❌ blokováno/odloženo

---

## Sprint 1 – Kostra ✅

- ✅ Expo 51 projekt, TypeScript, Expo Router
- ✅ `package.json`, `tsconfig.json`, `app.json`, `babel.config.js`, `.env.example`
- ✅ `supabase/schema.sql` — konsolidovaný, idempotentní, source of truth (viz sekce "Schema.sql cleanup")
- ✅ `src/types/database.ts` — TS typy + domain utility (`getExpiryStatus`, `formatExpiry`, `compareBoxesByExpiry`, `formatDateCs`, `toIsoDate`, `fromIsoDate`)
- ✅ `src/lib/supabase.ts` — klient + API (auth, warehouses, boxes, items, invitations, realtime)
- ✅ `app/_layout.tsx` — root layout, auth guard, deep link handler, `GestureHandlerRootView`
- ✅ `app/(auth)/login.tsx` — Apple Sign In s nonce, dev-only email/password fallback, `ensureWarehouse` po loginu
- ✅ `app/(auth)/_layout.tsx` — auth group layout
- ✅ `app/(app)/_layout.tsx` — stack navigator (bez nav headeru pro index screen)
- ✅ `app/(app)/index.tsx` — Dashboard s custom headerem, realtime subscription, useFocusEffect

---

## Sprint 2 – Core flow ✅

### Hlavní screeny
- ✅ `src/lib/openFoodFacts.ts` — EAN lookup + heuristické mapování kategorií
- ✅ `app/(app)/box/new.tsx` — formulář + QR náhled s placeholder tisku
- ✅ `app/(app)/scan.tsx` — QR scanner přes CameraView
- ✅ `app/(app)/box/[id].tsx` — detail bedny
- ✅ `app/(app)/box/[id]/add-items.tsx` — naskladňovací batch session

### Komponenty
- ✅ `src/components/ItemEditSheet.tsx` — edit položky
- ✅ `src/components/BoxEditSheet.tsx` — edit bedny

### Dodělávky po Sprint 2 feedback loop
- ✅ **A2** — Swipe-to-delete přes `react-native-gesture-handler` `Swipeable`
- ✅ **B** — Edit položky přes `ItemEditSheet` modal
- ✅ **C** — Nativní date picker (`@react-native-community/datetimepicker`, `display="inline"`, `locale="cs-CZ"`)
- ✅ **D** — Toggle Mřížka/Seznam + AsyncStorage perzistence
- ✅ **E** — Zobrazit QR štítek znovu přes modal
- ✅ **F** — Edit bedny + `ActionSheetIOS` menu (Štítek / Upravit / Smazat)
- ✅ **G** — Error states s retry pro Dashboard + Box detail
- ✅ **H** — Toast + haptic po přidání do fronty
- ✅ **I** — Svítilna ve scanneru (`enableTorch` prop)
- ✅ **J** — Source banner v draft formuláři (custom / OFF / manual)
- ✅ **K** — Copy QR do clipboardu
- ✅ **M** — Empty state CTA na dashboardu

### Odloženo / nezpracováno
- A1, A3 — alternativy k A2 (jen jedna přežije)
- Inline edit bedny v headeru — action sheet je čistší
- Per-box view mode perzistence — záměrně globální

---

## Session fixes & discoveries (první test run)

Při prvním pokusu o build a rozjetí appky se objevila série problémů, které jsou teď vyřešené. Zaznamenáno kvůli budoucí referenci:

### Build toolchain issues
- ✅ **Ruby / CocoaPods conflict s macOS system Ruby 2.6** — vyřešeno přes `brew install ruby` + přidání do `~/.zshrc` PATH, pak `gem install cocoapods` bez sudo
- ✅ **Expo SDK 51 × Xcode 26 / iOS 26 SDK inkompatibilita** — Apple v iOS 26 odstranil legacy macro `TARGET_IPHONE_SIMULATOR`, Expo modul `expo-dev-menu` ho ještě používal v `DevMenuViewController.swift`. Patch v `node_modules/expo-dev-menu/ios/DevMenuViewController.swift` — nahrazeno za `#if targetEnvironment(simulator)`. **POZOR:** patch se ztratí při `npm install` → do budoucna nastavit `patch-package` pro persistenci
- ✅ **Expo CLI nedefaultoval na simulátor** — explicitní `--device "iPhone 17 Pro"` nebo boot simulator přes `xcrun simctl boot` před `npx expo run:ios`

### Schema / RLS issues
- ✅ **Chicken-and-egg RLS v `createWarehouse`** — `.insert().select()` triggruje SELECT RLS na RETURNING, `is_member(id)` vyžaduje existující member record, ale ten se teprve vytváří v dalším kroku. Fix: `SECURITY DEFINER` RPC funkce `create_warehouse_for_me` (bypass RLS, atomická transakce). Viz `supabase/schema.sql`
- ✅ **Multi-warehouse ze selhaných loginů** — po dřívějších RLS failed pokusech zbyly orphan warehouses. Jednorázový cleanup SQL provedl consolidation
- ✅ **`getMyWarehouse` non-deterministic** — `limit(1)` bez `order by` vracel arbitrary warehouse → Dashboard a box/new mohly vidět jiný. Fix: `order by joined_at asc` pro deterministický výběr

### Realtime subscription issues
- ✅ **`supabase.channel('name')` cache collision** — při re-mount Expo routeru (Strict Mode nebo back nav) volání `subscribeItems`/`subscribeBoxes` s tím samým jménem vrátilo cached subscribed channel, `.on()` throwne. Fix: unique channel names s `Math.random()` + `supabase.removeChannel(channel)` v cleanup místo jen `unsubscribe()`
- ✅ **Supabase realtime publication missing tables** — `boxes`/`items` nebyly v `supabase_realtime` publication by default, žádné events nechodily. Fix: `alter publication supabase_realtime add table ...` v schema.sql (s exception handling v DO bloku kvůli idempotency)

### UI issues
- ✅ **`headerLargeTitle: true` overlap first card** — iOS large title vyžaduje ScrollView jako přímý child Stack navigatoru, ale FlatList je wrapnuté v SafeAreaView. Fix: `headerShown: false` + custom `<View><Text>Stockr</Text></View>` header v Dashboardu s `edges={['top', 'bottom']}` na SafeAreaView
- ✅ **Dashboard nerefreshuje po návratu z child screeny** — expo-router drží screeny v stack cache, `useEffect` se neřegne. Fix: `useFocusEffect` v Dashboard a box/[id] pro re-fetch při focus

### Supabase clipboard sync v simulátoru
- ⚠️ **Paste password do Apple ID v iOS Settings simulátoru nefunguje** — pro dev testing obejito přes `__DEV__`-only email/password login v `login.tsx`, test user vytvořen ručně v Supabase dashboardu (`test@stockr.local`)

---

## Schema.sql cleanup ✅

- ✅ **Konsolidován `fix-warehouse-rpc.sql` do hlavního `schema.sql`** — jediný source of truth
- ✅ **Plně idempotentní** — `create table if not exists`, `create index if not exists`, `drop policy if exists` + `create policy`, `drop trigger if exists` + `create trigger`, `create or replace function`, `on conflict do nothing` u inserts
- ✅ **Realtime publication v schematu** — 4 `alter publication supabase_realtime add table` pro boxes/items/warehouses/warehouse_members, wrapnuto v `do $$ exception when duplicate_object` pro re-runnable setup
- ✅ **Storage bucket v schematu** — `insert into storage.buckets` pro `product-images` s `public: true`
- ✅ **Handle_new_user trigger s on conflict** — ochrana proti duplicit insertu při edge cases (admin-created users)

---

## Sprint 2.5 – UI polish & tech debt ✅

Insertnutý mezi Sprint 2 a Sprint 3. Cíl: projekt převést do angličtiny, sjednotit design language (brand green paleta + custom ikonografie), vyřešit dlouhodobý tech debt kolem buildu před tím, než začneme přidávat další native moduly pro Sprint 3. **Uzavřeno 2026-04-13.**

### Fáze 1 — Tech debt ✅

- ✅ **Expo SDK 51 → 55.0.14 upgrade** (4 major verze)
  - React 18.2.0 → 19.2.0
  - React Native 0.74.5 → 0.83.4
  - Reanimated 3 → 4.2.1 (přidán `react-native-worklets` jako peer dep)
  - Všechny expo moduly na `~55.x`
  - TypeScript 5.3 → 5.9, `@types/react` → 19.2.10
  - `.npmrc` s `legacy-peer-deps=true` pro RN peer rezoluci
  - ChipRow null-guard fixy (TS 5.9 stricter)
  - `npx expo-doctor` 17/17 passes
- ✅ **patch-package fallback nepotřeba** — SDK 55 má iOS 26 kompatibilitu upstream, `DevMenuViewController` patch obsoletní

### Fáze 2 — Design system foundation ✅

- ✅ **`src/theme/colors.ts`** — **dark-first** sage green paleta odvozená z app icon gradientu
  - Sage scale 50–900, status colors tuned pro dark bg (vyšší luminosity)
  - Surfaces = rgba bílé overlay (6/10 %), text = #FFFFFF + rgba alpha
  - Expiry states jako rgba tint overlays
  - Hero tokeny (login/splash) = aliasy default tokens
- ✅ **`src/theme/spacing.ts`** — xs(4) / sm(8) / md(12) / lg(16) / xl(24) / xxl(32) / xxxl(48)
- ✅ **`src/theme/typography.ts`** — iOS HIG scale (largeTitle / title1–3 / headline / body / callout / subhead / footnote / caption / label)
- ✅ **`src/theme/radius.ts`** — sm / md / lg / xl / xxl / full
- ✅ **`src/theme/shadows.ts`** — none / sm / md / lg presety
- ✅ **`src/theme/index.ts`** — barrel export + `theme` objekt
- ✅ **Aplikovat napříč screeny** — Login (hero image), Dashboard, Box detail (list+grid), Box new, Add items, Scan, ItemEditSheet, BoxEditSheet
- ✅ **Hero assety** — `login-hero.png` (crate + gradient) a `screen-bg.png` (diagonal gradient TL→BR bez crate) generované přes PIL ze splash.png
- ✅ **`<ScreenBackground>` wrapper** — jednotný ImageBackground komponent na všech screens
- ✅ **Native stack headery hidden globálně**, custom in-screen top bary (back / title / more)
- ✅ **Status bar** přepnut na `light`, Stack contentStyle defaultně `colors.background`
- ✅ **Splash** sjednocen s login — app.json používá `login-hero.png` s cover resize módem pro seamless transition

### Fáze 3 — Iconography ✅

- ✅ **Inventarizace 32 ikon** v 4 batchích + mini batch
- ✅ **Generováno přes nano banana** — monochromatické sage green 3D ikony ve stylu app icon, postupně 4 batche + regen jednotlivých ikon
- ✅ **PIL chroma key cleanup** — nano banana vykreslila checker pattern jako RGB pixely, fix přes detection `|R-G| + |G-B| + |R-B| < threshold` a smooth alpha transition
- ✅ **Resize 2048×2048 → 512×512** (195 MB → 9.5 MB bundle)
- ✅ **`src/components/Icon.tsx`** — registry s 32 ikonami, `name` prop, optional `tintColor`
- ✅ **`CATEGORY_ICON`** mapping v `database.ts` pro Category → ikona
- ✅ **Nahrazení emoji napříč screens** — chrome (back, more, close, plus, ⋯), actions (edit, trash, copy, share, print, retry), input (camera, flashlight, scan-qr, grid, list), status (warning, inbox, check), category icons (food-can, medicine-pill, water-drop, disinfectant-bottle, tool-wrench, battery, document, box-generic), pin
- ❌ **iOS ActionSheetIOS emoji** ponecháno textově — systém neumožňuje image v native sheetu

### Fáze 4 — Translation to English ✅

- ✅ **`Category` enum**: Czech → English (food, medicine, water, disinfectant, equipment, energy, documents, other) + DB migrace
- ✅ **`Unit` enum**: ks→pcs, bal→pack + DB migrace
- ✅ **DB migration script**: `supabase/migrations/20260413_rename_enums_to_english.sql` — idempotentní, spuštěno v Supabase
- ✅ **`schema.sql` CHECK constraints** updated na EN hodnoty
- ✅ **`formatDateCs` → `formatDate`** rename, format DD. M. YYYY zachován
- ✅ **`formatExpiry`** texty přeloženy (Expired / Expires today/tomorrow/in X days/mo/yr)
- ✅ **Doménové termíny** — bedna→box, sklad→warehouse, naskladnit→add items, položka→item, expirace→expiry, štítek→label
- ✅ **UI stringy přeloženy** napříč všemi screens + sheety + alert dialogy + deep link handler
- ✅ **Date picker locale** `cs-CZ` → `en-GB`
- ✅ **Default warehouse name** `Domácí sklad` → `Home` (v `ensureWarehouse`)
- ✅ **openFoodFacts** category mapping + error messages přeloženy
- ⚠️ **Zbývající CZ komentáře v kódu** (supabase.ts, některé screens) — nepriorita, postupně

### Akceptační kritéria Sprintu 2.5 ✅

- [x] Appka se buildí a běží na Expo SDK 55
- [x] Žádný ruční patch v `node_modules` není potřeba (SDK upgrade fixnulo iOS 26 issue)
- [x] `src/theme/` existuje a všechny screeny ho používají místo hardcoded hexů
- [x] Žádný emoji v UI (kromě iOS ActionSheet — system limitation)
- [x] Všech 32 ikon z `assets/icons/` integrováno přes `<Icon />`
- [x] Žádná česká string v user-facing renderu
- [x] Sprint 1 + 2 flows stále fungují (smoke test ověřen, enum migrace OK)

---

## Sprint 2.6 – UI redesign (NoWaste style) ✅

**Kontext:** Sprint 2.5 uzavřel dark frosted-glass theme napříč celou appkou. User po použití v kontextu zpětně odmítl tento směr pro utility screens ("z toho UI designu se mi líbí akorát ta login screen, zbytek jsem asi trochu přemyslel"). Login hero zůstává, zbytek redesign do clean light NoWaste-style — pill cards, tab bar, FAB, SF Symbols místo 3D custom ikon.

**Reference:** NoWaste food inventory app (Main Pantry detail screen uložený v `screen/nowaste_fridge_detail.png`).

> 📌 **Pozn (2026-05-19 cleanup):** Inner ⏳ markery níže jsou **historical planning artifacts** z doby plánování sprintu. Sprint 2.6 je celý ✅ delivered (viz CLAUDE.md "Design system po Sprintu 2.6" pro confirmation). ⏳ v této sekci = "tohle byl plán který se zrealizoval", ne "open item".

### Fáze 1 — Theme retune (light-first palette)

- ⏳ **`src/theme/colors.ts`** rewrite z dark-first na light-first
  - `background` = `#F4F7F4` (subtle sage-tint, almost white)
  - `surface` = `#FFFFFF` (opaque cards)
  - `text` / `textMuted` / `textSubtle` — dark-on-light hierarchie
  - `border` = `#E5E8E5` (subtle dividery)
  - `primary` = sage green (zachován)
  - `danger` / `warning` / `success` — standard iOS-like saturované barvy (ne tlumené pro dark)
  - Expiry states — pastelové backgrounds (`#FEE2E2` red, `#FEF3C7` amber, `#DCEBE2` green, neutrální gray)
  - **`hero*` tokeny zachované** — login je pořád tmavý
- ⏳ **Shadows aktivně používat** — na light bg jsou vidět, na dark neměly efekt
- ⏳ **Ostatní theme moduly beze změny** (spacing / typography / radius / shadows)

### Fáze 2 — Icon library switch (SF Symbols)

- ⏳ **Install `expo-symbols`** — oficiální Expo package pro SF Symbols
- ⏳ **Rewrite `src/components/Icon.tsx`** na dual-namespace komponent:
  - `<Icon sf="magnifyingglass" size={20} color={colors.text} />` → expo-symbols
  - `<Icon brand="box-generic" size={96} />` → existující PNG asset z `assets/icons/`
- ⏳ **Migrace všech `<Icon name="...">` call sites** na `<Icon sf="..." />` pro chrome ikony
- ⏳ **Zachovat 3D ikony pro**:
  - Login/splash (už je používají jen jako hero image)
  - Empty states (velké 80–120 px illustrations): `box-generic` (empty Dashboard), `inbox` (empty box), `warning` (error screens), `camera` (permission screens)
- ⏳ **Category indicators v list cards** — SF Symbols (`fork.knife`, `pills`, `drop`, `wrench`, `bolt.fill`, `doc`, `shippingbox`, `bandage.fill`)
- ⏳ **`CATEGORY_SF_ICON` mapping** v `database.ts` (nahradí/doplní `CATEGORY_ICON` pro brand assets)

### Fáze 3 — Component primitives

- ⏳ **`src/components/Card.tsx`** — pill card, opaque white bg, shadow md, rounded radius lg, flexRow
- ⏳ **`src/components/FAB.tsx`** — floating pill button, sage green, icon + text, position absolute, shadow lg
- ⏳ **`src/components/ListHeader.tsx`** — title + search button + filter/sort icon
- ⏳ **`src/components/StatusDot.tsx`** — small colored circle pro expiry status indicator

### Fáze 4 — Tab bar restructure

- ⏳ **`app/(app)/_layout.tsx`** — přepsat ze `Stack` na `Tabs` (Expo Router)
- ⏳ **4 tab screens:**
  - `app/(app)/(tabs)/boxes.tsx` (bývalý `index.tsx`)
  - `app/(app)/(tabs)/items.tsx` (**nový** — flat cross-box expiring timeline)
  - `app/(app)/(tabs)/scan.tsx` (přesun)
  - `app/(app)/(tabs)/settings.tsx` (**nový** — sign out, placeholder pro future)
- ⏳ **Custom tab bar styling** — light bg, hairline top border, active tab sage green
- ⏳ **Tab bar icons** — SF Symbols (`shippingbox.fill`, `list.bullet`, `qrcode.viewfinder`, `gearshape.fill`)
- ⏳ **Stack screens mimo tabs** — `box/[id]`, `box/new`, `box/[id]/add-items` zůstávají jako push

### Fáze 5 — Screen rewrites

- ⏳ **`boxes.tsx`** (bývalý Dashboard) — ListHeader + pill cards + FAB `+ New box`
- ⏳ **`items.tsx`** (**nový**) — ListHeader + pill cards s `in [Box name]` subtitle, sorted by nearest expiry
- ⏳ **`settings.tsx`** (**nový**) — sign out + placeholder sekce
- ⏳ **`box/[id].tsx`** — light top bar, pill cards, FAB `+ Add items`
- ⏳ **`box/new.tsx`** — light form screen
- ⏳ **`box/[id]/add-items.tsx`** — light form + queue chip style
- ⏳ **`ItemEditSheet` + `BoxEditSheet`** — light modal bg, opaque inputs

### Fáze 6 — New DB query (pro Items tab)

- ⏳ **`src/lib/supabase.ts`** — nová funkce `listAllItemsInWarehouse(warehouseId)`
  ```sql
  select items.*, boxes.name as box_name
  from items
  join boxes on items.box_id = boxes.id
  where boxes.warehouse_id = $1
  order by items.expiry_date nulls last
  ```
- ⏳ **TS type** — `ItemWithBox = Item & { box_name: string }`

### Fáze 7 — Cleanup

- ⏳ **`<ScreenBackground>` wrapper** — ponechat jen v loginu; odstranit ze všech utility screens
- ⏳ **`assets/screen-bg.png`** — ponechat (nestojí to nic) nebo smazat pro menší bundle
- ⏳ **Dark-only tokens** — zachovat v `hero*` skupině, odstranit z utility code cest
- ⏳ **Unused 3D ikony** — zachovat v `assets/icons/` dormant pro budoucí hero moments

### Akceptační kritéria Sprintu 2.6

- [ ] Appka používá 4-tab layout (Boxes / Items / Scan / Settings)
- [ ] Všechny utility screens mají light bg bez gradientů
- [ ] Pill cards místo frosted glass rows
- [ ] Floating pill FAB pro primary action (kontextuální per screen)
- [ ] SF Symbols pro všechny chrome ikony
- [ ] 3D custom ikony jen v empty states a login (+ splash)
- [ ] Login screen beze změny (dark hero)
- [ ] Items tab ukazuje cross-box flat list s box name per item
- [ ] Sprint 1 + 2 flows stále fungují

---

## Sprint 2.7 – Multi-warehouse + opened flag ✅

**Kontext:** Backend schéma (warehouse_members + RLS helpers) je multi-tenant ready od začátku, ale UI předpokládá jeden sklad per uživatel a auto-createne ho v `_layout.tsx` při prvním loginu. Tohle blokuje reálný sharing flow: když A pozve B, B už má vlastní auto-created sklad a appka neví, který ukázat. Sprint 2.7 udělá ze **skladu first-class resource** — user má seznam skladů, může jich mít víc, pozvánka druhému uživateli se mu rovnou objeví v jeho seznamu (přes realtime sub na `warehouse_members`).

Druhý, menší kus sprintu: **pack size** na items. Currently lze říct "2 pack", ale nevíme kolik kusů je v balení. Leky/medicine use case: "2 packs × 20 = 40 tablets" jako odvozený total. Ukládá se per-EAN v `custom_products`, takže další nákup stejného produktu se předvyplní.

**Rozhodnutí z plánovací session (2026-04-14):**
- Global settings (sign out, profile) → **profile icon top-right** na Warehouses list screen (ne druhý root tab)
- Terminologie v UI zůstává **warehouse** (Sprint 2.5 convention), jen se mění hierarchie screenů
- Pack size bundled do 2.7, ne samostatný warm-up
- **Role model = Multi-owner** (co-owners): `warehouse_members.role` může být `owner` na víc řádcích, kterýkoliv owner může invitovat/přejmenovat/mazat/promote/demote. Invariant: vždy ≥1 owner.
- **Invite flow má "Invite as co-owner" checkbox** rovnou v invite dialogu (ne jen ex-post promote v members listu)

> 📌 **Pozn (2026-05-19 cleanup):** Inner ⏳ markery níže jsou **historical planning artifacts** z doby plánování sprintu. Sprint 2.7 je celý ✅ delivered. ⏳ v této sekci = "tohle byl plán který se zrealizoval", ne "open item".

### Fáze 1 — Schema & data layer

- ⏳ **Zkontrolovat `warehouse_invitations` tabulku** + existenci `createInvitation` / `acceptInvitation` funkcí v `supabase.ts` (plán říká že existují, ověřit reálně)
- ⏳ **Role model — multi-owner**:
  - Ověřit `warehouse_members.role` enum/check constraint — pokud neobsahuje `owner`, migrace ho přidá
  - `is_owner(wh)` RLS helper upravit tak, aby vracel `true` i pro `warehouse_members.role = 'owner'`, ne jen pro `warehouses.owner_id = auth.uid()`
  - Ověřit, že `warehouses.owner_id` se stále naplní při `createWarehouse` (ten pak dostane i řádek v `warehouse_members` s `role='owner'`) — redundance OK, `owner_id` je quick lookup, `warehouse_members` je zdroj pravdy pro RLS
  - Při `acceptInvitation` respektovat `role` z invite tokenu (member/owner), ne hardcoded `member`
  - DB trigger nebo CHECK constraint: **warehouse nesmí existovat bez alespoň 1 ownera** — při delete/demote posledního ownera operace selže (nebo RLS zajistí na appce, ale robustnější na DB)
- ⏳ **Migrace** (idempotentní SQL script):
  - `custom_products.pack_size numeric NULL`
  - `custom_products.pack_unit text NULL` (`"tablet"`, `"ml"`, `"g"`, …)
  - Schema tweaky pro multi-owner (viz výše)
- ⏳ **`getMyWarehouses(userId)`** → array s rolí per sklad (join přes `warehouse_members`)
- ⏳ **Nové API funkce** v `supabase.ts`:
  - `createWarehouse(name) → Warehouse` (vytvoří warehouse + `warehouse_members` row s `role='owner'` pro current user)
  - `renameWarehouse(id, name)` (owner only)
  - `deleteWarehouse(id)` (owner only)
  - `leaveWarehouse(id)` (kdokoliv, ale owner může opustit jen pokud existuje ≥1 další owner — jinak error)
  - `listMembers(warehouseId)` → s role info
  - `promoteMember(warehouseId, userId)` — nastaví `role='owner'` (volající musí být owner)
  - `demoteMember(warehouseId, userId)` — nastaví `role='member'` (volající musí být owner, invariant: nesmí demotovat posledního ownera)
  - `removeMember(warehouseId, userId)` — owner vyhodí jiného membera (nesmí vyhodit posledního ownera)
  - `createInvitation(warehouseId, role)` — rozšířit o `role` parametr (`'member' | 'owner'`), default `'member'`
- ⏳ **Realtime sub helper** `subscribeToMyWarehouses(userId, cb)` — filter `user_id=eq.{userId}` na `warehouse_members`
- ⏳ **Odstranit auto-create** z `app/_layout.tsx` (řádek co při loginu volá `ensureWarehouse` nebo podobné)

### Fáze 2 — Route restructure (největší kus, bolestivé)

- ⏳ `app/(app)/(tabs)/*` → `app/(app)/warehouse/[id]/(tabs)/*`
- ⏳ `app/(app)/box/*` → `app/(app)/warehouse/[id]/box/*`
- ⏳ **`app/(app)/index.tsx`** = nový Warehouses list (nahrazuje přímé zobrazení Boxes tabů)
- ⏳ **`app/(app)/warehouse/new.tsx`** = Create warehouse form
- ⏳ Update všech `router.push` / `router.replace` / `<Link>` call sites — většina teď potřebuje `warehouseId` parametr
- ⏳ **`warehouseId` context** — per-screen buď z `useLocalSearchParams()` nebo helper hook `useCurrentWarehouseId()`
- ⏳ Refactor `listAllItemsInWarehouse`, `listBoxes`, atd. — všechny už berou `warehouseId`, ale teď musí přijít z URL, ne z globálního "my warehouse" lookup

### Fáze 3 — Warehouses list screen (nový root)

- ⏳ **Empty state**: pill card "No warehouses yet" + 2 akce `[+ Create warehouse]` a `[Accept invitation]` (druhá je optional pro handoff deep linku mimo Messages)
- ⏳ **Populated state**: pill card per warehouse s:
  - Warehouse name (big)
  - Role badge (`Owner` / `Member`)
  - Subtitle: počet členů + počet beden (optional)
- ⏳ **Profile icon top-right** → `ActionSheetIOS` nebo bottom sheet: "Signed in as {email}" + Sign out
- ⏳ **FAB** `+ New warehouse` → push `warehouse/new.tsx`
- ⏳ **Tap na card** → push `warehouse/[id]/(tabs)/index.tsx`
- ⏳ **Realtime sub** subscribe v `useEffect`, unsubscribe v cleanup — warehouses naskočí automaticky když server potvrdí nové členství

### Fáze 4 — Create warehouse form

- ⏳ **`warehouse/new.tsx`** — jednoduchá form: name input, Create button
- ⏳ Po úspěchu: `router.replace('/warehouse/{id}/(tabs)')` — user rovnou skočí dovnitř nového skladu

### Fáze 5 — Warehouse settings tab (per-warehouse)

- ⏳ **`warehouse/[id]/(tabs)/settings.tsx`** nahrazuje bývalý global `settings.tsx`
- ⏳ **Header sekce**: warehouse name + Rename action (inline nebo sheet, owner only)
- ⏳ **Members sekce**: list s email + role badge (`Owner` / `Member`) + **Invite member** button (owner only)
- ⏳ **Per-member ActionSheet** (long-press nebo "…" na row) — viditelný jen pro ownery:
  - Promote to owner (pokud member)
  - Demote to member (pokud owner) — disabled pokud by demote znamenal 0 ownerů
  - Remove from warehouse — disabled pokud target je poslední owner
- ⏳ **Destruktivní akce** na konci:
  - **Owner** → `Delete warehouse` (red, confirmation alert)
  - **Member** → `Leave warehouse` (red, confirmation alert)
  - **Owner, ale poslední** → Leave disabled s vysvětlením "You are the last owner. Promote someone else first or delete the warehouse."
- ⏳ Po Delete/Leave → `router.replace('/')` zpět na Warehouses list

### Fáze 6 — Invitation flow

- ⏳ **Invite button v settings** → otevře **Invite sheet** s:
  - Info text ("Share this link with someone to give them access…")
  - **Checkbox / toggle**: `Invite as co-owner` (default off) — pokud zapnutý, pozvánka nese `role='owner'`
  - `[Generate link]` button → volá `createInvitation(warehouseId, role)` → získá token
- ⏳ **Share link** přes `expo-sharing` nebo `Share.share()` — obsah: `stockr://invite/{token}`
- ⏳ **Deep link handler** v `app/_layout.tsx` — parser už existuje (ze Sprintu 2), napojit na `acceptInvitation(token)` při příjmu URL
- ⏳ **Pre-auth case**: když user klikne na invite link ale není přihlášený → persist token do `SecureStore`, po loginu zpracovat (existující flow v Sprintu 4 plánu, ale minimální verze sem)
- ⏳ **Post-accept**: realtime sub na B automaticky doplní sklad do seznamu, žádný manual refresh

### Fáze 7 — Role-aware UI (minimální verze)

- ⏳ **Jen na warehouse úrovni** — `getMyWarehouses` vrací roli per sklad, Warehouses list zobrazuje badge (Owner / Member)
- ⏳ **Warehouse settings tab** — podmíněně rendruje Rename / Invite / Delete / Promote / Demote / Remove jen ownerům; members vidí read-only list + Leave
- ⏳ **Multi-owner invariants** — vynucené jak na DB (check/trigger), tak v UI (disabled buttons s vysvětlením):
  - Nesmí vzniknout warehouse s 0 ownery
  - Owner nemůže opustit/být demotován/být odebrán, pokud je poslední
- ⏳ **Box/item level zůstává role-agnostic** — každý člen může zatím všechno, plná role gate je Sprint 4

### Fáze 8 — Pack size feature

- ⏳ **`ItemEditSheet`**: conditional input "Tablets per pack" (nebo obecnější "Units per pack") když `unit = pack`
- ⏳ **Upsert `custom_products.pack_size` + `pack_unit`** při save, přes EAN — další nákup stejného produktu se předvyplní
- ⏳ **`getTotalUnits(item)`** helper v `src/types/database.ts` — vrací `quantity * pack_size` nebo `null` když `unit != pack`
- ⏳ **Items tab + box detail** — secondary text pod hlavním řádkem: `"2 packs × 20 = 40 tablets"` (jen když pack_size k dispozici)
- ⏳ Open Food Facts prefill — pokud OFF vrací `product_quantity` nebo podobné, zvážit auto-mapping na pack_size

### Fáze 9 — Cleanup & test

- ⏳ **Smazat staré routes / starý global `settings.tsx`** mimo warehouse kontext
- ⏳ **Aktualizovat CLAUDE.md** struktura sekce — nové cesty pod `warehouse/[id]/...`
- ⏳ **Projít end-to-end flows** v simulátoru:
  - Nový user login → empty state → Create warehouse → scan & add box/items
  - Existing user → Rename warehouse → Invite member (druhý simulátor / Apple ID)
  - B přijme pozvánku → sklad naskočí do listu → vejde do něj → vidí boxes A
  - B Leave warehouse → sklad zmizí
  - Owner Delete warehouse → zmizí všem členům
  - Ibuprofen item s pack_size=20, quantity=2 → Items tab ukáže "40 tablets"

### Akceptační kritéria Sprintu 2.7

- [ ] Nový user po loginu nevidí auto-created sklad, ale empty state s možností Create / Accept
- [ ] Po vytvoření prvního skladu se ocitne v jeho tabech (Boxes / Items / Scan / Warehouse settings)
- [ ] Profile icon top-right na Warehouses list otevírá Sign out
- [ ] User A pošle invite link → B naskočí sklad do Warehouses list bez ručního refreshe
- [ ] A může poslat invite s zapnutým "Invite as co-owner" → B přijme → B má role `owner` na skladu, vidí Delete/Rename/Invite
- [ ] A může v Members listu povýšit existujícího membera na ownera a naopak
- [ ] Poslední owner nemůže Leave / být demotován / být odebrán (UI i DB to odmítnou)
- [ ] Member vidí v settings "Leave", Owner vidí "Delete" — ne obojí
- [ ] Po Delete/Leave se user vrátí na Warehouses list a sklad zmizí
- [ ] Ibuprofen s `unit=pack`, `quantity=2`, `pack_size=20` zobrazí secondary text `"2 packs × 20 = 40 tablets"`
- [ ] Pack size se předvyplní při dalším naskenování stejného EAN
- [ ] Sprint 1 + 2 + 2.6 flows stále fungují (boxes list, add items, scan, box detail, sheets)

---

## Sprint 3 – Tisk a AI ✅ (uzavřen 2026-05-19)

### Brother PT-P710BT tisk (revised plan)
**Rozhodnutí:** Brother PT-P710BT místo Niimbot B21. Důvody: AirPrint support (žádný BLE reverse engineering), laminované pásky vydrží 20+ let (prepper requirement), multi-use pro celou domácnost.

**Phase 1 — hardware-independent ✅** (uzavřeno 2026-04-15)
- ✅ Tiskárna objednaná 2026-04-14 (čekáme na doručení pro Phase 2)
- ✅ `expo-print` + `qrcode` (npm) + `expo-sharing` + `expo-asset` + `expo-file-system/legacy` deps (native rebuild)
- ✅ `src/lib/qrLabel.ts` — HTML template pro 80×24mm TZe tape (227×68pt). Dvoustupňový print: `Print.printToFileAsync({ html, width, height })` → PDF s exact embedded page size → `Print.printAsync({ uri })` do AirPrint dialogu (přímé HTML cestu iOS ignoroval a defaultil na A4)
- ✅ **Dynamická velikost fontu** pro box name — heuristika `54mm / (nameLength × 0.62)` s height cap 9/13mm, floor 2mm, max 10mm. Krátké názvy ("Leky") vyplní celou výšku, dlouhé se zmenší až na 2mm aby se vešly
- ✅ **Text center-align** — krátké názvy se centrují mezi QR a pravý okraj labelu, dlouhé se roztáhnou na celou šířku
- ✅ **QR logo overlay** — `assets/label-logo.png` (nano banana generated 3D isometric crate), auto-cropped přes Python PIL (bbox detection, Gemini watermark removal, background clean-up → 32% pure white), zaoblený 8px black border baked-in (38px radius = 15%), 7.5mm tile v QR (~42% width, ~17% area, pod 30% ECC-H tolerance)
- ✅ Error correction level **H** (30% damage tolerance) pro scanner reliability s logo overlay
- ✅ `printBoxLabel(box)` + `shareBoxLabelPdf(box)` v `qrLabel.ts` — print + Save PDF fallback přes iOS share sheet
- ✅ Napojeno v `LabelModalContent` (`box/[boxId].tsx`) + post-create QR preview (`box/new.tsx`) — dva buttony "Print label" (sage primary) + "Save PDF" (subtle share helper)
- ✅ **In-app QR views používají stejný asset** — `react-native-qrcode-svg` s `logo={require(...)}`, `logoSize={92}`, `logoBorderRadius={12}` matching print proporcemi. Vizuální konzistence mezi screen preview a fyzickým tiskem

**Phase 2 — hardware test** ✅ (2026-04-15, tiskárna dorazila)
- ✅ Tiskárna PT-P710BT spárovaná v iOS Settings → Bluetooth (Connected stav)
- ✅ **Klíčové zjištění: iOS system print dialog Bluetooth-only printery nevidí.** AirPrint scanuje přes Bonjour/WiFi, Bluetooth tiskárny tam nejsou. Brother iPrint&Label ani novější P-touch Design&Print 2 nepřijímají file imports (PDF ani PNG, ani přes share sheet — "Cannot share files"). Ani Photos-based workflow nefunguje, Brother apps jsou template-only.
- ✅ **Jediná funkční cesta = Brother Mobile Print SDK integrace** (viz Sprint 3F)
- ❌ Niimbot BLE protokol — zrušeno, Brother SDK má oficiální knihovnu
- ✅ Real-device landscape print test verified 2026-05-19 (Sprint 3F)

### Sprint 3D extras — iterativní ladění label layoutu
- ✅ **Rotation fix** — Brother SDK treats PDF width jako tape width (ne shorter-dim-auto). Landscape PDF (80×24mm) → 0.3× scale → miniature output. Fix: portrait PDF (24×80mm) + content rotated 90° via CSS transform. `@page size: 68pt 227pt`, `.label` absolute positioned + `translate(-50%, -50%) rotate(90deg)`, zachován horizontální visual design.
- ✅ **Font sizing iterace**: `computeNameFontSize` heuristika refinovaná — charRatio 0.58 → 0.62 (konzervativnější), floor 3mm → 2mm (delší názvy fit), height cap 13mm bez location / 9mm s location, max 10mm. Plus `text-align: center` na `.text` container pro vizuální vycentrování krátkých názvů mezi QR a pravým okrajem tape.
- ✅ **Label logo iterace** přes Python PIL pipeline: auto-crop bbox detection (non-white region), Gemini watermark nuke (threshold <150), background clean-up (luminance ≥230 → pure white), 8px rounded rectangle border baked-in (38px radius = 15% = subtle rounding), 7.5mm tile v QR (~42% width). Matching `logoBorderRadius={12}` v in-app `react-native-qrcode-svg` views.

### Claude Vision pro produkty bez EAN ✅
**Architektura pivotovala od Supabase Edge Function → direct client call s per-user API klíčem v SecureStore.** Důvody: nulový risk leaku v TestFlight binary, každý user si řídí vlastní útratu, simpler deploy (žádná Deno function). Claude Code subscription nejde použít — je vázaná na OAuth CLI, nemůže sloužit jako token pro mobile app.
- ✅ `src/lib/secureStore.ts` — Keychain-backed helpers pro `stockr.anthropicKey`
- ✅ `src/lib/vision.ts` — direct fetch na `api.anthropic.com/v1/messages`, model `claude-haiku-4-5`, tool_use pro structured output (`{ name, category, typical_shelf_life_days }`), `cache_control: ephemeral` na tool def pro 5-min prompt cache. `MissingApiKeyError`, `hasAnthropicKey()`, `formatShelfLife()`, `testAnthropicKey()` helpery
- ✅ `app/(app)/profile.tsx` — nový global profile screen dostupný přes profile icon na Warehouses list. Email + display name + Claude Vision section (Set/Change/Test/Remove key s Alert.prompt a `sk-ant-` validation) + Sign out
- ✅ **Path A (auto)**: OFF 404 v `add-items.tsx` → pokud má user klíč, alert "Product not in database. Take photo to identify?" → camera → upload → Claude → prefill name/category → shelf life hint + upsert `custom_products`
- ✅ **Path B (manual button)**: "✨ Identify with AI" button (sage tint, sparkles icon) viditelný když `visionEnabled && draft.image_url`. Re-identifikuje na existing image URL bez dalšího uploadu.
- ✅ Shelf life jako **hint** (ne auto-prefill datumu) — text "Typical shelf life: ~2 years — check the label" pod expiry picker, viditelný jen když datum není vyplněné
- ✅ Caching: `upsertCustomProduct` s `typical_expiry_days` po úspěšné identifikaci. Další scan stejného EANu preskočí Claude call (custom_products prefill path) a z cached `typical_expiry_days` ukáže stejný hint

### Upload obrázků do Supabase Storage (Fáze A — nízkoriziková) ✅
- ✅ Bucket `product-images` automaticky vytvořený přes schema.sql (public: true)
- ✅ Storage RLS policies: `product_images_read` (public select), `product_images_insert/update/delete` (authenticated-only)
- ✅ `src/lib/storage.ts` — `uploadProductImage(warehouseId, localUri)` pipeline: `ImageManipulator` resize (800px width, 70% JPEG) → `new File().arrayBuffer()` (nový FS API místo broken `fetch+blob` v RN) → upload → `getPublicUrl`. Path convention: `{warehouse_id}/{timestamp}-{random}.jpg`. `deleteProductImage(publicUrl)` helper s safe no-op pro external URLs (OFF thumbnails se neřeší).
- ✅ `expo-image-picker` + `expo-image-manipulator` + `expo-file-system` deps installed (native rebuild nutný)
- ✅ `ItemEditSheet` — 160×160 thumbnail tile nahoře, tap → `ActionSheetIOS` (Take photo / Library / Remove). Upload overlay spinner. `warehouseId` prop pass-through z obou callers.
- ✅ `add-items.tsx` form — 140×140 tile s category ikonou + "Tap to add photo" hint v empty state. `handleAddToQueue` blokuje Save during upload.
- ✅ Reused v Claude Vision flow (Path A uses same upload pipeline)
- ℹ️ Orphan cleanup v storage není — pokud user uploadne foto a pak draft cancelne, soubor zůstane. Acceptable MVP, fix v Sprint 5+.

### Custom products rozšíření
- ✅ Upsert při přidání draftu se známým EAN — už je
- ⏳ Settings screen `settings/products.tsx` pro spravování custom DB — odložené, never built; post-launch nice-to-have (viz Technical debt)

### Sprint 3E — TestFlight build pipeline ✅ (2026-04-15)
Posun z Sprint 5 plánu předem, protože Brother PT-P710BT Bluetooth vyžaduje real-device test (simulátor nemá Bluetooth stack). Tím máme zároveň připravenou distribuci pro manželku.
- ✅ `eas-cli` installed + Expo account + `eas login`
- ✅ `eas init` — projekt `6bbb7a4b-68d2-423f-9832-a070ff1fa99e` pod ondrej.michalcik ownerem
- ✅ `eas.json` s `preview` profilem (distribution: store, autoIncrement: true, channel: preview, environment: preview) a `production` profilem jako budoucnostni. `appVersionSource: remote` aby EAS spravoval buildNumber server-side.
- ✅ `app.json` — `ios.buildNumber: "1"` initial, `ITSAppUsesNonExemptEncryption: false` (obchází export compliance prompt při každém buildu)
- ✅ EAS env vars — `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` jako plaintext visibility v `preview` environmentu (ne secrets protože jsou EXPO_PUBLIC_* bundled client-side stejně)
- ✅ **expo-updates** auto-installed během prvního `eas build` — přidal `runtimeVersion.policy: appVersion` + `updates.url` do app.json. OTA JS updates připraveny pro budoucí use (`eas update --channel preview`)
- ✅ Apple credentials — first build interactive flow: Apple ID + 2FA → EAS auto-vytvořil Distribution Certificate + Provisioning Profile (uloženo na EAS server, reusable pro další buildy)
- ✅ `eas submit --platform ios --latest` — auto-vytvořil App Store Connect record (Stockr, bundle `com.ondrejmichalcik.stockr`, ASC App ID 6762301537) + auto-vytvořil App Store Connect API Key `[Expo] EAS Submit` uložený na EAS serveru
- ✅ TestFlight Internal Testing setup — Family group s Enable Automatic Distribution, assignment buildu na group. Apple build processing ~5-10 min → Ready to Test state
- ✅ iPhone install flow — TestFlight app na iPhonu (auto-loginnutý přes iCloud Apple ID), Stockr naskočí v Apps sekci, install + open. Apple Sign In flow funguje na reálné devicu.
- ℹ️ **Gotchas** (pro budoucí builds): Apple Developer user status musí být "Active" (ne "Pending") nebo TestFlight internal tester nevidí app. iCloud Apple ID na iPhonu musí match ASC user email. Internal testers nedostávají email invite (na rozdíl od external) — app se prostě objeví v jejich TestFlight app pokud match email.

### Sprint 3F — Brother Mobile Print SDK integrace ✅ (2026-04-15 + verified 2026-05-19)
Po zjištění že iOS system print dialog Bluetooth tiskárnu nevidí a Brother consumer apps (iPrint&Label / P-touch Design&Print 2) nepřijímají file imports, jedinou reálnou cestou je direct Brother SDK integrace.
- ✅ `expo-brother-printer-sdk@0.7.0` (rakeshta) — Expo-compatible wrapper nad Brother Mobile Print SDK (xcframework bundled)
- ✅ **Patch-package setup** — `patches/expo-brother-printer-sdk+0.7.0.patch` přidává PT series support (knihovna defaultně supports jen QL). Postinstall hook v package.json zajišťuje re-apply při `npm install` v EAS cloud.
- ✅ Patch obsah: do `SettingsUtils.swift` přidán `_parseSettings_PTSeries` co vytvoří `BRLMPTPrintSettings(defaultPrintSettingsWith: model)` s `labelSize` mapnutým na `BRLMPTPrintSettingsLabelSize` enum (24mm TZe tape = index 5). `_printerModelFromName` rozšířen o PT-P710BT + 16 dalších PT modelů. `settingsFromDictionary` má nový `modelName.hasPrefix("PT")` branch.
- ✅ **Swift rename gotcha** — `BRLMPrinterModelPT_P715eBT` Swift importuje jako `.pt_P715eBT` (lowercase kvůli lowercase `e` uprostřed ruší acronym heuristiku), ostatní PT modely jsou `.PT_P710BT` etc. První build compile fail, fix na jeden model enum value.
- ✅ `src/lib/vision.ts` nezměněn; `src/lib/qrLabel.ts` přidána `printBoxLabelViaBrotherSDK(box)` funkce: generuje PDF přes `printToFileAsync` → `BrotherPrinterSDK.searchBluetoothPrinters()` najde paired channely → prefer PT-series match → `BrotherPrinterSDK.printPDF(uri, channel, { labelSize: 5, autoCut: true })` přes Bluetooth
- ✅ `LabelModalContent` (box/[boxId].tsx) + `box/new.tsx` — **3 print button stack**: **Print to Brother** (primary sage, Brother SDK path), **AirPrint / other** (secondary, iOS system dialog pro budoucí WiFi printery), **Save PDF** (tertiary, share sheet fallback)
- ✅ **Real print test verified** (2026-05-19) — landscape PDF rotation works on real PT-P710BT hardware

**Známé zbytky kterým se může dařit špatně v real-world testu:**
- Rotation direction — pokud `rotate(90deg)` vyjde tape s QR na špatné straně, swap na `rotate(-90deg)` nebo `270deg`
- Label size enum — nastaveno na 24mm (index 5); pokud by default PT-P710BT čekal jinou indexaci, fallback na `BRLMPTPrintSettingsLabelSizeWidth24mm` přes pure default settings bez override
- Channel model name format — Stockr `.startsWith('PT-')` match, pokud Brother SDK vrátí `"Brother PT-P710BT"` místo `"PT-P710BT"`, match selže. Easy fix: loose match.
- Tape leading/trailing margin — Brother TZe má ~1.5-2mm physical non-print area na každé straně. Pokud content má cutoffy, snížit padding v HTML nebo labelSize settings.

---

## Strategická změna — offline-first + App Store 🧭 (2026-04-15)

**Insight od uživatele**: Stockr je **prepper emergency tool**. Musí fungovat i když internet není dostupný. TestFlight je inherentně nekompatibilní:
- TestFlight builds **expirují po 90 dnech**, pak user bez connection k Apple serverům nemůže app otevřít
- Brother tiskárna je offline-only workflow, datový layer (Supabase) aktuálně ne
- Hardware upgrade nebo re-install bez internetu = stuck

**Důsledek pro roadmap**: TestFlight je vhodný pro DEVELOPMENT testing (jsme teď), ale **finální distribuce musí jít přes App Store** (unlimited app lifetime, žádný Apple serverový check-in pro běh).

**A datový layer musí být offline-first** — aktuálně každé operace jde do Supabase přes síť. Bez internetu appka nefunguje. Musíme přejít na **local-first architecture** kde:
- Primary data source = local SQLite / reactive DB na zařízení
- Cloud Supabase = sync backup a sdílení mezi zařízeními
- Pracovní mode při offline: appka funguje 100% lokálně, změny se frontují do sync queue
- Při reconnection: sync engine vyřeší conflicts (last-write-wins pro 2-user family use)

**Přepriorizace budoucích sprintů**:
1. **Sprint 3F Brother print** — dokončit (waiting on build)
2. **Sprint 4' — Offline-first data layer** (nový, vysoká priorita) — viz níže
3. **Sprint 4 — Push notifikace** — lze kombinovat s offline (local notifications pro expiraci, nepotřebují server)
4. **Sprint 5 — App Store release** — poslední, až offline je stabilní

---

## Sprint 4' – Offline-first data layer ✅ (2026-04-17 — 2026-04-18)

**Cíl**: Stockr fully offline-capable. Appka funguje bez internetu (reads + writes + QR scan + print), sync s Supabase automaticky když je síť dostupná.

**Architektura**: Custom SQLite + vlastní sync engine (`expo-sqlite`). Zvoleno kvůli: žádné external deps, maximum kontrola, konzistentní s prepper principem.

### Implementované fáze

- ✅ **SQLite schema** (`src/lib/localDb.ts`) — mirror všech Supabase tabulek + sync metadata (`_synced`, `_changed_fields`, `_deleted_at`, `_local_updated_at`) + `_sync_queue` + `_conflicts`
- ✅ **Initial full sync** (`sync.ts → initialFullSync`) — při prvním loginu stáhne vše z Supabase do SQLite
- ✅ **Read path** (`localQueries.ts`) — 12 read funkcí, všechny `supabase.ts` read funkce → SQLite first → Supabase fallback
- ✅ **Write path** (`localWrites.ts`) — core CRUD (boxes, items) + move + open + condition + warehouses + inventory + custom products, vše SQLite-first s sync queue
- ✅ **Push sync** (`sync.ts → pushSync`) — FIFO z `_sync_queue`, INSERT→upsert, UPDATE→patch changed fields, DELETE→hard delete
- ✅ **Pull sync** (`sync.ts → pullSync`) — incremental fetch (updated_at > last_pulled_at), auto-merge nekonfliktních polí, conflict detection pro overlapping changes
- ✅ **Conflict resolution UI** (`app/(app)/conflicts.tsx`) — per-field výběr local vs server, quick actions "Keep all mine" / "Take all server"
- ✅ **Global SyncStatusBar** (`src/components/SyncStatusBar.tsx`) — dole na všech screenech, stavy: hidden/offline/syncing/conflicts/pending, tap na conflicts → navigace
- ✅ **Offline indicator** (`useNetworkStatus` hook + `expo-network`) — poll 15s + app foreground check, auto-sync on reconnect
- ✅ **Image cache** (`src/lib/imageCache.ts`) — SHA-256 hash → `.jpg` + `.meta` sidecar, prefetch po sync pull, cache po uploadu, orphan cleanup na app startu
- ✅ **Session persistence** — `cachedUser` v AsyncStorage přežívá token expiry, `lastUser` přežívá sign-out, "Continue offline" tlačítko na login screenu
- ✅ **Sign-out ochrana** — offline: warning + "Sign out anyway" volba, online: warning o nutnosti internetu pro re-login
- ✅ **P2P sync** — custom Expo native modul `stockr-multipeer` (MultipeerConnectivity), `p2pSync.ts` export/import s last-write-wins merge, UI screen `app/(app)/p2p-sync.tsx`
- ✅ **Deep link fix** — `+native-intent.tsx` rewrites `stockr://invite/*` na `/` předtím než Router matchuje, `app/invite/[token].tsx` fallback route

### Rozhodnutí
- **Realtime subscriptions ponechány** — online bonus, offline nic nerozbijí, `useFocusEffect` refreshuje data
- **createWarehouse** — server-first s offline fallback (RPC vytváří membership atomicky)
- **Invitations/member ops** — zůstávají Supabase-only (vyžadují síť z principu)
- **P2P sync** — MultipeerConnectivity (Bluetooth/WiFi), auto-accept invitations (same service = trusted family), encrypted transport

---

## Sprint 4 – Notifikace ✅ (2026-04-18)

### Pozvánky (done in Sprint 2.7)
- ✅ Invitation flow kompletní — create, share, accept, deep link handler
- ✅ Deep link fix: `+native-intent.tsx` + `app/invite/[token].tsx` fallback route

### Local expiry notifications
- ✅ `src/lib/notifications.ts` — `expo-notifications` local scheduling
- ✅ Idempotent reschedule: cancel all → re-schedule z SQLite dat při každém app foreground
- ✅ **3 reminder windows: 60d, 30d, 1d** (2026-04-18 redesign — viz session níže) — user-configurable v Profile
- ✅ **Grouped notifications** — jedna notifikace per (window, crossing day) se seznamem itemů co toho dne překračují threshold. Title např. "3 items with ≤30 days", body list jmen + "+N more"
- ✅ Notification tap → `/alerts/[window]` screen s aktuálním filtrovaným seznamem (cross-warehouse)
- ✅ iOS ~64 notification limit → cap na 60, sorted by nearest trigger
- ✅ App badge count = počet items expirujících do 60 dní (widest window)
- ✅ Foreground handler — notifikace se zobrazí i když je app otevřená
- ✅ Global on/off toggle + per-window toggles v Profile screenu
- ✅ Vše lokální — žádný server push, funguje plně offline

---

## Sprint 5 – App Store Release 🚧 (in progress; jediný blocker = screenshots, 2026-05-19)

### Rebrand
- ✅ **Stockr → Kalta** (2026-04-23)
  - Bundle ID `com.ondrejmichalcik.kalta`, EAS project recreated
  - Native module `kalta-multipeer` (Swift class, podspec, JS, Bonjour service type), info.plist services renamed
  - All docs, web copy, schema.org JSON-LD updated
  - Domain `kalta.app` purchased on Cloudflare

### Public website ✅ (live na https://kalta.app)
- Astro static site (5 + 6 docs pages = 11 stránek), self-hosted Inter font, OG image generator, sitemap, schema.org SoftwareApplication
- Hostováno na Cloudflare Pages, custom doména `kalta.app`
- `/privacy`, `/terms`, `/support`, `/docs/*` — markdown imports z `docs/legal/`, `docs/support/`, `docs/guide/`
- `/docs/*` má sidebar nav, prev/next pagination, breadcrumb (Stripe-like)
- Favicon přes resized app icon (16/32/48/96/180/192/512 + ICO + SVG wrapper)
- Apple-touch-icon, web manifest pro PWA

### Legal & metadata docs ✅
- `docs/legal/privacy-policy.md` — GDPR-compliant, 392 řádků, EU hosting (Supabase Ireland), Anthropic BYOK opt-in disclosure
- `docs/legal/terms-of-service.md` — paid app, Apple Standard EULA reference, Czech governing law, IČO/DIČ vyplněné
- `docs/support/faq.md` — troubleshooting-only po refaktoru (how-to obsah je v `docs/guide/`)
- `docs/app-store/listing.md` — name, subtitle, description, keywords, what's new, age rating
- `docs/app-store/app-privacy.md` — Apple privacy nutrition labels (vychází ze data audit: žádné tracking, žádné analytics)
- `docs/app-store/review-notes.md` — pro Apple reviewera, "use your own Apple ID"
- `docs/setup/paid-app-setup.md` — step-by-step App Store Connect (Paid Apps Agreement, W-8BEN s Article 12, banking, contacts, SBP, Family Sharing, promo codes)
- `docs/app-store/screenshots.md` — capture plán pro 6.9" iPhone simulator

### Pricing rozhodnutí (2026-04-25 → 2026-05-15)
- ❌ ~~**Tier 10 ($9.99)** one-time~~ — původní plán; one-time cena pokryla ~2-3 roky Supabase hostingu per user, dál ztrátová → 2026-05-15 pivot na subscription model (viz Sprint 5.5)
- ✅ **Tier 15 ($14.99 / year) auto-renewing subscription** — free download, hard paywall na first launch
- ✅ **Apple Small Business Program** — enrollment submitted 2026-05-19, awaiting Apple approval (rate aktivuje od Q3 = July 1, pokud approve do mid-June)
- ✅ **Family Sharing** enabled — manželčin Apple ID added do Family group; po release dostane Kalta zdarma přes shared subscription
- Detaily v Sprint 5.5 sekci níže

### App Store Connect setup ✅
- ✅ Apple Developer Program ($99/rok, expire 12 Apr 2027)
- ✅ Free Apps Agreement: Active
- ✅ **Paid Apps Agreement Active** (2026-05-18) — Name Identification Document approved, bank ticket 19765769 resolved, DAC7 + DSA compliance "No" (Kalta is standalone software, not gig platform)
- ✅ Tax W-8BEN — Czech, Article 12 royalties, 0% withholding, Active
- ✅ Bank info — Air Bank AS (CZK / USD royalty), Active
- ✅ Contacts — všechny 4 role = Ondřej Michalčík
- ⏳ Apple Small Business Program approval — submitted 2026-05-19, awaiting (non-blocker, defaults 30 % until approved)
- ✅ App record creation + metadata (subscription product `com.ondrejmichalcik.kalta.cloud_yearly` Tier 15, Family Sharing enabled, EN+CS localizations, paywall review screenshot from `screen/IMG_6775.PNG`)
- ✅ Family Sharing toggle ON for subscription
- ❌ **Screenshots na 6.7" Display (6 screens)** — **only remaining blocker for Submit**
- ⏳ `Submit for Review` (gated na screenshots)

### EAS Build pipeline ✅
- ✅ EAS account on Production plan
- ✅ `appVersionSource: "remote"` + `autoIncrement: true` — buildNumber server-side
- ✅ Env vars push do preview environment (Supabase URL + publishable key)
- ✅ **Build 22** (2026-04-25) — Bonjour services + KaltaMultipeer autolinking
- ✅ **Build 23** (2026-04-26) — P2P review-and-accept + pending screen + sync v2 + image compression + Universal Links
- ✅ **Build 24** (2026-04-26 follow-up) — P2P transport reliability (encryption `.none`, peer dedupe, ACK protocol, delivery pill, auto-bundle response, connect watchdog) + sync v3 (full pull, ghost cleanup) + coupled-field conflicts
- ✅ **Build 25+** (2026-05-15 onward) — subscription enforcement enabled (commit 6d121a3), expo-iap + StoreKit Config, all Sprint 5.5 phases live in TestFlight, plus reliability fixes (P2P invite watchdog `a184f90`, circular import fix `2ac19cc`, cached-identity boot `c180dca`, sign-out resilient `3af998f`, deferred image upload `37a1f8f`, sweep-storage Edge Function `65639e6`)

### Assety
- ✅ `assets/icon.png` — 1024×1024, sage green 3D wooden box s QR kódem (RGBA)
- ✅ `assets/icon-appstore.png` — 1024×1024 RGB (alpha stripped) pro App Store upload (Apple odmítá alpha)
- ✅ `assets/splash.png` — splash + login hero
- ✅ `screen/IMG_6775.PNG` — paywall screenshot (1290×2796, used as subscription product review screenshot in ASC)
- ❌ App Store listing screenshots (6× 6.7" Display from iPhone, real-data setup) — **blocker for Submit**

---

## Sprint 5.5 – Subscription pivot ✅ code, 🚧 launch (2026-05-15 → 2026-05-18)

Mid-launch pivot z **Tier 10 one-time ($9.99)** na **Tier 15 yearly subscription ($14.99/year)**. Motivace: one-time cena pokryje ~2–3 roky Supabase hostingu per user, dál ztrátový. Subscription matchuje recurring cost s recurring revenue.

**Model:**
- Free download, hard paywall na first launch pro never-subscribed users
- $14.99/year, **NO trial** (immediate paid subscription)
- Lapse → **local-only mode** (data + edity pokračují lokálně, cloud features off)
- 30-day TTL: cloud data se mažou 30 dní po lapse (local data nikdy)
- StoreKit 2 + `expo-iap` + local verification (žádný backend, plně offline-first)
- Family Sharing enabled (manželka pokrytá automaticky)

**Phases 1–9 ✅ code-complete** (commits 4709226 → 853fe19). Flag `SUBSCRIPTION_ENFORCEMENT_ENABLED` flipped to `true` 2026-05-18 (commit 6d121a3).

Phase details (each is a single commit, all gated transparently while flag was false):
- Phase 1 — `expo-iap@4.2.8` + `storekit/Kalta.storekit`
- Phase 2 — `src/lib/subscription.ts`: useSubscription hook, AsyncStorage cache, transaction listener
- Phase 3 — `app/paywall.tsx`: hero + 4 value props + Subscribe + Restore/Terms/Privacy + canDismiss
- Phase 4 — cloud gates: pushSync / uploadProductImage / deleteProductImage / identifyProduct (CloudFeatureDisabledError)
- Phase 5 — `app/_layout.tsx` auth guard: status `never` → /paywall mandatory, `active`/`lapsed` → app
- Phase 6 — Profile SUBSCRIPTION sekce + Manage/Restore actions
- Phase 7 — SyncStatusBar lapsed banner (warning, tap → renew)
- Phase 8 — docs/legal/{terms,privacy} + docs/app-store/* + docs/setup/paid-app-setup + docs/support/faq + web/* + supabase/schema.sql (`users.subscription_expires_at` + `cleanup_lapsed_cloud_data()` + pg_cron)
- Phase 9 — `.claude/test-scenarios.md` sekce 12 (12 scénářů)

**Reliability follow-ups (mezi flagem a launchem):**
- `a184f90` — P2P invite watchdog + auto-invite (řeší "10 attempts to pair")
- `2ac19cc` — circular import fix (supabase.ts ↔ sync.ts ↔ subscription.ts) co freezovalo getSession
- `c180dca` — cached identity first, getSession na pozadí (5-min spinner fix)
- `3af998f` — sign out resilient k wedged supabase auth state

**Apple gates ✅ (2026-05-18):**
- Paid Apps Agreement Active (bank ticket 19765769 vyřešen + DAC7 "No")
- ASC sub product `com.ondrejmichalcik.kalta.cloud_yearly` (Tier 15, Kalta Cloud group, Family Sharing, EN+CS, paywall screenshot z `screen/IMG_6775.PNG`) → **"Ready to Submit"**

**TestFlight sandbox ✅ ověřeno:**
- Subscribe → "Sandbox" banner, no charge, app vstoupí
- Profile → SUBSCRIPTION "Active · Renews 2026-05-19" (sandbox accelerated)
- Restore: sign out + sign in → no re-paywall
- Manage Subscription → iOS Settings sheet
- Photo upload → Supabase Storage works
- Lapse flow nezkoušen (acceptable pro v1.0, gates verified v review)

**App Store v1.0 prep status:**
| Section | Status |
|---|---|
| Version page 1–12 (Promo Text, Description, Keywords, URLs, What's New, Build, IAP attach, Review Info, Manual release) | ✅ |
| App Privacy nutrition labels | ✅ |
| Age Rating (4+) | ✅ |
| Screenshots (6× 6.7" Display) | ❌ **jen tohle blokuje Submit** |
| Submit for Review | blocked na screenshots |

**Příští session — postup:**
1. Setup demo data v iPhone Kalta (2 warehouses, items s color-varied expiry)
2. Power + Volume Up = 6 screenshots dle `docs/app-store/screenshots.md` pořadí
3. AirDrop do Mac → ASC version page → 6.7" Display → drag upload
4. Screenshot #6 můžeš reuse `screen/IMG_6775.PNG` (paywall)
5. **Submit for Review** vpravo nahoře → Apple 24–48h response
6. Pokud Approved + Manual release → klikneš "Release this version" kdy chceš go-live

**Otevřené body (post-launch):**
- Receipt validation pro `expires_at` push (anti-falsify) — trust client currently OK
- Deferred image upload pro lapsed users (items v lapsed jsou bez image_url)
- Storage object cleanup (Edge Function pro orphan images)
- Family Sharing setup pro manželku (jen Apple Settings krok, can wait)
- Sync slowness (~1 min before 2026-05-17 sign-out/sign-in cycle, neotestováno po auth reset)

---

## Sprint 6 – Readiness 📋 (navrženo 2026-05-20, čeká na rozhodnutí o realizaci)

**Cíl:** Posunout Kaltu z "inventory tracker" na "readiness tool". Odpovědět na **THE prepper otázku**: "Kolik dní přežiju?" Čtyři propojené featury tvoří uzavřený loop:

```
FOUNDATION (sdílená data)
  • Household config (počet lidí per warehouse)
  • Nutritional data per item (kcal/100g + net váha) — z Open Food Facts
  • Par levels (min množství per item)
        ↓                          ↓
READINESS DASHBOARD          PAR / LOW-STOCK alerts
"X dní pro Z lidí"                  ↓
        ↓                    SHOPPING / RESTOCK LIST
COVERAGE GAPS          ←──── (agreguje: expired + below-par + gaps)
"chybí ti léky/baterie"
```

### Consumption model — DECIDED: nutritional (cal/100g + package size)

Rozhodnutí 2026-05-20 (Ondřejův návrh, lepší než původně zvažované category defaults): místo hrubých category průměrů použít **reálná nutriční data per item**. Open Food Facts je už vrací — stačí rozšířit lookup.

**Food coverage (kcal-based):**
```
total_kcal = Σ (energy_kcal_per_100g / 100 × net_weight_g × quantity)
food_days = total_kcal / (people × DAILY_KCAL)   // DAILY_KCAL default 2000
```

**Water coverage (volume-based):**
```
total_liters = Σ (objem v litrech podle unit l/ml nebo net_volume)
water_days = total_liters / (people × DAILY_WATER_L)   // default 3 L
```

**Ostatní kategorie** (medicine/equipment/energy/disinfectant/documents): ne "dny", ale **coverage gaps** (máš/nemáš + par level), readiness-days nedávají smysl.

**Readiness headline = weakest-link:** `min(food_days, water_days, ...)` → "Tvoje slabina: voda, 4 dny". Pod tím per-category breakdown.

### Rozhodnutí (zafixováno 2026-05-20)

- **Scope: per-warehouse readiness ve v1.** Každý warehouse má vlastní `people_count`, readiness se počítá jen z jeho zásob ("Home Pantry: 12 dní jídla pro 4 lidi"). Aggregate cross-warehouse ("total survival capacity přes všechny lokace") je pozdější enhancement — většina uživatelů má primárně 1 hlavní sklad, a aggregate komplikuje různé people_count + sharing.
- **`people_count` ≠ `warehouse_members`.** Members = kdo appku spravuje; people_count = koho zásoby živí. Explicitní field, ne odvozeno.
- **Surface: summary card + detail screen.** Glanceable banner na vrchu warehouse dashboardu (Boxes tab) — "⚠️ Voda: 4 dny — tvoje slabina" / "✓ 18 dní ready". Tap → full readiness detail screen. Žádný 5. tab, konzistentní s existing expiry attention bannerem na dashboardu.
- **Pets: skip ve v1.** Zvířata potřebují jiný consumption rate; přidává komplexitu. Enhancement pokud bude poptávka.

### Data model additions

`warehouses`:
- `people_count` int default 1
- (volitelně později: `daily_kcal_target`, `daily_water_l` override — default 2000 / 3; `pets_count`)

`items` nové sloupce:
- `energy_kcal_per_100g` numeric null — z OFF `nutriments['energy-kcal_100g']`
- `net_weight_g` numeric null — váha per jednotka/balení, parse z OFF `product_quantity`
- `min_quantity` numeric null — par level (low-stock threshold)

OFF integrace (`openFoodFacts.ts`) extension:
- Fetch `nutriments['energy-kcal_100g']` + `nutriments['energy-kj_100g']` fallback
- Parse `quantity` string ("500 g", "1.5 l", "6 x 1.5 l") → normalized net amount + unit
- Auto-fill při scanu; manual override v ItemEditSheet

### Build sekvence (kdyby šlo do realizace)

1. **Household config** — schema: `warehouses.people_count` int default 1. UI: nová **HOUSEHOLD** sekce v `warehouse/[warehouseId]/(tabs)/settings.tsx` se stepperem (− N +). Lokální write přes localWrites + sync.
2. **OFF nutritional fetch + items columns** — schema migrace (`energy_kcal_per_100g`, `net_weight_g`, `min_quantity`). Extend `openFoodFacts.ts` lookup o `nutriments` + quantity-string parser. ItemEditSheet + add-items: nutriční pole (auto-filled ze scanu, manual editovatelné).
3. **Readiness calc engine** — `src/lib/readiness.ts`: čistá funkce `computeReadiness(items, peopleCount)` → `{ foodDays, waterDays, weakestLink: { category, days }, perCategory: [...] }`. Žádný UI, jen logika + unit-testovatelná.
4. **Readiness summary card** — komponenta na vrchu `warehouse/[warehouseId]/(tabs)/index.tsx` (Boxes dashboard), vedle/nad existing expiry attention banneru. Weakest-link headline + tap.
5. **Readiness detail screen** — `warehouse/[warehouseId]/readiness.tsx` (push z card): headline dní + per-category coverage bary ("Food 18d / Water 4d / ...") + "for N people" label + odkaz na shopping list.
6. **Par levels + low-stock** — `items.min_quantity` UI v ItemEditSheet, low-stock badge na item cards (quantity < min), feeduje shopping list.
7. **Coverage gaps** — recommended kit baseline (per kategorie: má warehouse aspoň X?), "chybí ti: medicine, batteries" sekce v readiness detailu.
8. **Shopping list** — `warehouse/[warehouseId]/shopping.tsx`: agregace (expired items + below-par items + coverage gaps) → checklist, mark-purchased → optional rovnou pre-fill add-items flow.

Realisticky **~1-2 týdny**. Sekvenovatelné — kroky 1-5 (readiness core) jsou jeden ucelený kus; 6-8 (par/gaps/shopping) druhý, samostatně užitečný i bez readiness dashboardu.

### Otevřené otázky před realizací

- **net_weight parsing z OFF quantity string** — "6 x 1.5 l" / "500g" / "1,5 kg" formáty messy. Fallback na manual entry když parse selže.
- **Water v pcs (lahve)** — potřebuje net_volume_ml per lahev (z OFF quantity). Nebo user zadá unit=l rovnou.
- **Items bez OFF dat** (custom products, manual entry) — nutriční pole prázdná → nezapočítají se do readiness, nebo prompt na manual fill.
- **Recommended kit template** — hardcoded prepper baseline (co každý kit má mít) vs user-defined targets?
- **Daily targets** — 2000 kcal / 3 L hardcoded vs configurable per household?

### Rozhodnutí: realizovat po launchi
Sprint 6 je post-launch. Priorita až po App Store v1.0 release + prvním reálném user feedbacku. Nevstupuje do launch blockingu.

---

## Technical debt

> **Pozn.:** patch-package a Expo SDK upgrade byly vyřešeny ve **Sprint 2.5**. Aktualizováno 2026-05-20 po dokončení celé tech debt fronty.

### Vyřešeno ✅

- ~~Role awareness~~ — gating implementováno ve Sprintu 5, verified 2026-04-25
- ~~Refresh invalidace realtime~~ — vyřešeno přes `realtimeEcho.ts` (2026-04-26)
- ~~Settings screen + sign out~~ — žije v `app/(app)/profile.tsx` (Sprint 5)
- ~~Dev-only email/password login~~ — odstraněno v Phase 8 cleanup
- ~~TS errors `profile.tsx:504` + `StatusDot.tsx:15`~~ — fixnuto 2026-05-19 (commit 2aba003), typecheck čistý
- ~~Deferred image upload pro lapsed users~~ — commit 37a1f8f (2026-05-19). Lapsed photo → cache pod `local:` URI → na renew flushDeferredImageUploads uploadne + enqueue UPDATE
- ~~Storage object cleanup~~ — commit 65639e6. `sweep-storage` Edge Function, weekly cron (Sun 04:00 UTC), confirmed working
- ~~Custom products management screen~~ — commit 65c855d. Existing screen rozšířen o full edit sheet (name/category/shelf life) + image thumbnails + search/filter
- ~~Receipt validation server-side~~ — commits a80e3f9 → e6df19d (2026-05-20). `verify-receipt` Edge Function: local JWS verification (Apple Server API path 401'd → pivot), cert chain pinned na Apple Root CA G3, column-level RLS revoke (jen service role píše sub columns). Confirmed POST 200, DB write verified.

### Operational / nízká priorita (žádný actionable trigger)

**Error handling granularita**
- Aktuální error states jsou Alert + log. Save failures nemají retry-with-backoff pro síťové operace
- Zvážit při prvních reálných incidentech (zatím žádné nehlášené)

**Lapse flow end-to-end verification**
- Gates kódově ověřené, ale UX naživo neotestovaný (sandbox cancel z TestFlight nejde na iOS 18+ s real Apple ID — manuál cancel není možný)
- Validuje se organicky po launchu prvními real lapsed users

**Tech debt fronta je vyčerpaná** — vše substantial je hotové. Zbylé dvě položky čekají na reálná data z produkce, ne na implementaci.

---

## Dependencies (snapshot — vždy verify proti `package.json`)

**Po SDK upgrade ve Sprintu 2.5 + průběžných additions:**

```
Core
  expo               ~55
  react              19.2.0
  react-native       0.83.4
  typescript         ~5.9.2

Expo moduly (klíčové)
  expo-router        ~55
  expo-apple-authentication
  expo-camera, expo-clipboard, expo-constants, expo-crypto
  expo-dev-client, expo-document-picker
  expo-file-system, expo-font
  expo-haptics, expo-iap, expo-image-manipulator, expo-image-picker
  expo-linking, expo-network, expo-notifications
  expo-print, expo-secure-store, expo-sharing
  expo-splash-screen, expo-sqlite, expo-status-bar, expo-symbols
  expo-system-ui, expo-updates

Custom native modules
  kalta-multipeer (MultipeerConnectivity P2P)
  expo-brother-printer-sdk (Brother Mobile Print + PT series patch)

Third-party
  @supabase/supabase-js
  @react-native-async-storage/async-storage
  @react-native-community/datetimepicker
  react-native-gesture-handler
  react-native-qrcode-svg
  react-native-reanimated, react-native-worklets
  react-native-safe-area-context, react-native-screens
  react-native-svg, react-native-url-polyfill
  qrcode
```

Authoritative source = `package.json`. Tahle sekce slouží jen pro kontext, ne pro lock.

---

## Aktuální stav prostředí (refreshed 2026-05-19)

### Backend
- ✅ Supabase projekt `rlpjcdpqzejcfncjipve` (production)
- ✅ `schema.sql` spuštěný — tabulky + RLS + triggery + RPC + realtime + storage bucket + subscription columns + cleanup function + pg_cron schedules
- ✅ Apple provider zapnutý v Supabase (Client ID: `com.ondrejmichalcik.kalta`, Allow users without email: ON)
- ✅ Realtime replication enabled pro `boxes`, `items`, `warehouses`, `warehouse_members`
- ✅ Storage bucket `product-images` (public) — vytvořený
- ✅ pg_cron + pg_net extensions enabled
- ✅ Cron jobs active: `kalta-cleanup-lapsed-cloud-data` (daily 03:00 UTC), `kalta-sweep-storage` (Sunday 04:00 UTC)
- ✅ Edge Function `sweep-storage` deployed
- ✅ Vault secrets / `app.settings.service_role_key` setup (přes hardcoded JWT v cron command — solo project trade-off)

### Frontend / Build
- ✅ `.env` vyplněný `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- ✅ Expo SDK ~55, React 19, RN 0.83 (po Sprintu 2.5 SDK upgrade)
- ✅ Native moduly: expo-iap, expo-camera, expo-haptics, expo-sqlite, expo-notifications, expo-brother-printer-sdk + `kalta-multipeer` custom module — vše v EAS Build pipeline
- ✅ `npm run typecheck` clean (od commit 2aba003)
- ✅ TestFlight Build 25+ active, subscription enforcement ON, all flows tested in sandbox
- ✅ EAS env vars set v preview environment

### Apple Developer
- ✅ Apple Developer Program aktivní (expire 12 Apr 2027)
- ✅ App ID `com.ondrejmichalcik.kalta` registrován s capabilities: Sign In with Apple, Push Notifications, In-App Purchase
- ✅ Paid Apps Agreement Active (2026-05-18)
- ✅ Bank, Tax, Contacts, DAC7, DSA — vše Active
- ⏳ Apple Small Business Program — submitted 2026-05-19, awaiting Apple review

### Assety
- ✅ `assets/icon.png` — 1024×1024, sage green 3D wooden box s QR (RGBA)
- ✅ `assets/icon-appstore.png` — 1024×1024 RGB pro App Store upload
- ✅ `assets/splash.png` + `assets/login-hero.png` — login/splash
- ✅ `screen/IMG_6775.PNG` — paywall screenshot for ASC IAP review
- ❌ App Store listing screenshots (6× 6.7") — blocker

---

## Quick commands

```bash
# Install deps po pull
npm install

# Spustit Metro bundler (dev)
npx expo start --dev-client --clear

# Native build pro iOS (po přidání nového native modulu)
npx expo run:ios --device "iPhone 17 Pro"

# Vynucený clean build (když build cachuje problém)
rm -rf ios/Pods ios/Podfile.lock
npx expo prebuild --clean --platform ios
npx expo run:ios

# Re-applikovat DevMenuViewController patch (po npm install)
# V node_modules/expo-dev-menu/ios/DevMenuViewController.swift ~ line 66:
# Nahradit `let isSimulator = TARGET_IPHONE_SIMULATOR > 0`
# Za #if targetEnvironment(simulator) ... #endif blok

# TypeScript check
npm run typecheck     # alias pro `tsc --noEmit`

# EAS build pro TestFlight (Sprint 5)
eas build --platform ios --profile preview
eas submit --platform ios
```

---

## Příště začít

Po otevření nové session (stav 2026-05-18 EOD):

App Store submission je rozpracovaná. Apple Paid Apps Agreement = Active. Subscription product v ASC = Ready to Submit. TestFlight build s `SUBSCRIPTION_ENFORCEMENT_ENABLED=true` ověřený end-to-end (subscribe / restore / manage / photo upload OK).

**Jediný blocker pro Submit = screenshots.**

1. **Setup demo data v iPhone Kalta** (~5 min):
   - 2 warehouses (např. "Home Pantry", "Garage Supplies")
   - V každé bedna s items
   - Items s color-varied expiry (red expired / amber soon / green ok)
   - Aspoň 1 item s photo

2. **Capture 6 screenshots** (Power + Volume Up):
   1. Warehouses list (root)
   2. Box detail s items color-coded
   3. Scan tab (scanner active)
   4. Box → Show QR label modal
   5. Warehouse → Settings tab (members + invite)
   6. Paywall — reuse `screen/IMG_6775.PNG`

3. **AirDrop do Mac** → ASC → tvoje Kalta → App Store → version page → **6.7" Display** section → drag 6 souborů.

4. **Submit for Review** button se aktivuje vpravo nahoře → klikni → Apple 24–48h.

5. Po **Approved** (Manual release zvolen) → ASC ukáže "Release this version" button → klik kdy chceš go-live.

**Post-launch follow-ups (až pak):**
- Family Sharing setup manželky (iPhone Settings → Family Sharing → add)
- Sync slowness investigation (pokud přetrvává)
- Deferred image upload pro lapsed users
- Edge Function pro storage orphan cleanup

Detail: [.claude/implementation-plan.md Sprint 5.5 section](#sprint-55--subscription-pivot--code--launch-2026-05-15--2026-05-18).

### Session 2026-04-26 — Build 23 field-test + Build 24 reliability pass

První reálný multi-device test buildu 23 s manželkou odhalil tři kategorie problémů: **P2P transport flaky**, **sync má ghost rows**, **picker UX nesmyslný bez context**. Pasivní oprava 9 věcí napříč code path. Vše JS-only až na native MCSession a permission UI fix → potřeba native rebuild (Build 24).

**P2P transport reliability:**
- **MCSession encryption `.none`** (z `.required`) — single biggest reliability problem. Šifrovací handshake na `.required` často timeoutoval, manželka s Ondrejem zkoušeli connect 6–10× než to chytlo. Bezpečnost OK: oba peers trusted (stejný Bonjour service `kalta-sync`, signed app, bundle ID), Bluetooth/AWDL transient nearby link, household-scale data.
- **Dedupe `discoveredPeers`** v `KaltaMultipeerModule.swift` podle `displayName` — iOS Bonjour občas re-discoveruje peer s **novým MCPeerID** po krátkém dropu, invite stale ID tiše selhával.
- **JS connect watchdog 15s** — pokud MCSession zaseklo v `.connecting` bez delegate event, `stopSession()` + 500ms pauza + `startSession()` znovu, návrat do searching. Žádný indefinite spinner.
- **ACK protocol** — `P2PMessage` rozšířen o `{ type: 'ACK'; ackOf: 'BUNDLE'|'ACCEPT'|'REJECT' }`. Příjemce každé non-ACK zprávy okamžitě echo-pošle ACK. Odesilatel ho čeká 4s; když ne, **delivery pill flipne na "failed"**.
- **Persistent status strip** v top baru pro phases connected+ — zelený/oranžový dot (Connected · jméno / Disconnected) + delivery pill (`Sending decision…` → `decision delivered` ✓ / `not delivered — try Resend` ⚠).
- **Auto-bundle response** — když peer's BUNDLE dorazí a `myBundleSentRef === false`, automaticky pošlu svůj BUNDLE zpátky. Předtím protokol vyžadoval, aby OBA peeři tapnuli "Sync now" — když to udělal jen jeden, druhý zůstal v `exchanging` napořád.
- **Manual Resend tlačítko** na `waiting_peer` screenu — když uživatel suspectuje že ACK timeout, pošle ACCEPT znovu.
- **Console.log diagnostika** — `[p2p] → ACCEPT bytes=156` / `[p2p] ← ACK (ackOf=ACCEPT)` pro debugging via Xcode Console.

**Sync engine v3 (cloud + ghost cleanup):**
- **Drop incremental `gt('updated_at')` filter** na boxes a items pull. Bug: když manželka přidá usera do **existujícího** skladu, jeho boxes/items mají `updated_at` starší než user's `lastBoxPull` → server query je vyfiltruje pryč → user nikdy nedostane data. Volume v household scale je malý, full pull je safe call.
- **Items pull přes `boxes!inner(warehouse_id)` join**, ne přes lokální `boxIds`. Předtím: pokud box nebyl v lokální SQLite (kvůli filteru výše), items v něm byly silently skipped. Teď inner join garantuje fetch všech items v user's warehouses + RLS sanity check.
- **Surface pull errors** v console.warn — předtím `const { data } = await supabase...` ignoroval `error`. Tichá selhání u memberships/boxes/items jsou now logged.
- **Ghost row cleanup** — local `_synced=1` rows missing v server's full snapshot = **server hard-delete co lokálně nebyl propagován** (Supabase nemá soft-delete v schématu, takže pull nikdy nemazal). Detected case: manželka má lokální item, "synced" UI, ale server tam nic nemá. Po pullu se cleanup smaže (skip `_synced=0` aby se zachovaly pending creates).

**Coupled-field conflicts (quantity + unit):**
- **Bug:** Lenka editovala 25 pcs → 9 kg (oba fieldy). Ondřej editoval jen quantity. Ondrejův algoritmus označil jen `quantity` za conflict, `unit` za auto-merge. Lenčin oba za conflict. **Asymetrické pickery → různé resolution map keys → po Accept disagreement screen pokaždé.** Plus picker zobrazoval jen "MINE 25 / THEIRS 9" — bez unit kontextu nesmyslné rozhodnutí.
- **Fix vrstva 1 — algorithm**: nový `src/lib/syncFieldGroups.ts` s `COUPLED_FIELDS = { items: [['quantity', 'unit']] }` a `promoteCoupledConflicts(table, conflictFields, diffFields)`. Když je quantity v conflict_fields a unit se mění, unit se promotuje (a naopak). Helper sdílen mezi `sync.ts` (cloud pull), `p2pSync.ts` (preview + apply path).
- **Fix vrstva 2 — UI**: ReviewCard / ConflictCard / pending screen detekují coupled item a **skipnou separátní `unit` řádek**. Picker pro quantity používá `formatValueWithContext` → "MINE 25 pcs / THEIRS 9 kg". Tap MINE/THEIRS atomicky setuje **obě** resolutions (quantity i unit) tak, aby zůstaly v lockstepu.
- Aplikováno v `app/(app)/conflicts.tsx` (cloud sync conflicts), `app/(app)/p2p-sync.tsx` (P2P review), `app/(app)/pending.tsx` (offline diff display).

**Drobné fixes:**
- **Permission gate v add-items.tsx** se vyhodnocoval bez ohledu na `mode`. Když user tapnul "Add manually", `setMode('form')` proběhl, ale další render dál vracel permission screen. Fix: `if (!permission.granted && mode === 'scan')`. "Add manually" teď funguje bez camera permission.
- **Allow camera button** chybí `styles.btn` (padding/radius), jen `btnPrimary` (jen background). Vypadalo "zmrsene". Plus oba buttony se v `center` (`alignItems: 'center'`) smrskaly na šířku obsahu — různé. Fix: oba `[styles.btn, styles.btnX, styles.permBtn]` se `alignSelf: 'stretch', minWidth: 240`.
- **Dev-only email/password login removed** z `app/(auth)/login.tsx` — `__DEV__` wrapped, prod stejně neviděl, ale cleanup před App Store submission.
- **Pending revert disabled pro `inventory_lines`** — append-only audit data, revert by audit corruptl. UI tlačítko se schová pro tento table.
- **Realtime self-event echo suppression** — nový `src/lib/realtimeEcho.ts` (5s sliding window, max 200 entries). `enqueueChange` označí každý write přes `markRecentLocalWrite`; `subscribeBoxes` / `subscribeItems` / `subscribeMyWarehouses` ignorují server echo vlastních zápisů přes `isOwnEcho(payload)`. Eliminuje redundantní `load()` po každé lokální mutaci. Cross-device updates projdou normálně (tracker per-process).

**Klíčová rozhodnutí této session:**
- **`encryption: .none` je správný trade-off** pro household P2P. Apple by ti řekl ať použiješ `.required`, ale skutečnost je že MCSession encryption handshake je notoricky nespolehlivý a dataset (rodinné sklady) není citlivý dataset který by zasluhoval enforced TLS přes ad-hoc Bluetooth.
- **Coupled field promotion řeší symetrii** mezi peers — bez ní jsou resolution maps pokaždé různé a P2P review-and-accept skončí na disagreement screenu, i když uživatelé chtějí stejnou věc.
- **Ghost cleanup používá `_synced=1` jako safety pojistku** — řádky pending push (`_synced=0`) zůstávají i kdyby na serveru nebyly. Plus pull error gating (`!boxErr` / `!itemErr`) — když query selže, neděláme tabula rasa nad prázdnou odpovědí.
- **Full pull > incremental pull** v household scale. Bandwidth je zanedbatelný, jistota že dataset je up-to-date je daleko cennější než šetření pár KB každých 30s.
- **ACK protocol je must-have** pro UX — bez něj user neví jestli to dorazilo, a "spinner forever" ničí důvěru ve feature. Protokol je teď self-diagnosing — buď vidíš "delivered ✓" nebo víš co opravit.

**Otevřené drobnosti:**
- **Ondrejova ghost-item zatím přežívá** — to byl item který chyběl i po reinstall. Server data confirmed neexistuje, item je čistě lokální fantom u Lenky. Ghost cleanup ho na příští sync vyčistí.
- **Connection state badge nemá retry button** — když pill ukáže "not delivered", retry je jen z explicit "Resend my decision" buttonu na waiting_peer. Mohl by být dvouklikáč přímo z pill.
- **Connect watchdog 15s je heuristický** — Apple nikde negarantuje upper bound, mohlo by být že legitní handshake na slabém signálu trvá déle. Dataset N=2 (já + manželka) není reprezentativní.

---

### Session 2026-04-23 → 2026-04-25 — Sprint 5 launch prep + sync engine v2

Týden zaměřený na **App Store launch readiness** a **major sync engine improvements**. Ze stockr se stala kalta, web je live, právní dokumenty hotové, P2P prošel kompletním redesignem.

**Rebrand Stockr → Kalta:**
- Bundle ID `com.ondrejmichalcik.kalta`, EAS projekt znovu vytvořený (starý "stockr" smazaný přes web dashboard)
- Native modul `modules/kalta-multipeer/` (Swift `KaltaMultipeerModule`, podspec, `Name("KaltaMultipeer")`, JS API)
- Bonjour service type `kalta-sync` (was `stockr-sync`) — runtime-critical match
- Brother SDK plugin přepisoval `NSBonjourServices` v Info.plist; fix přes plugin parametry (`bonjourServices`, `bluetoothAlwaysUsageDescription`, `localNetworkUsageDescription`)
- Doména `kalta.app` koupená na Cloudflare

**P2P sync — kompletní redesign:**
- **Native module konečně linkovaný** — chyběl `package.json` v module folderu + iOS platform target byl `16.0` (proti app target `15.1`); CocoaPods proto modul odmítal
- **Per-field merge + conflict detection** — replaced row-level last-write-wins. Stejná logika jako cloud sync engine. `_changed_fields` z payloadu, `findDiffFields` + overlap, automerge or `_conflicts` insert
- **Baseline-aware conflict detection** (oba sync engines, cloud i P2P) — eliminuje false-positive konflikty kdy lokální user edited a server nemá ještě my push (`server.updated_at == baseline.updated_at` → skip; jinak per-field comparison vs baseline values)
- **Peer's `_changed_fields` honored** — bundle SELECT * propaguje peer's pending edit set. Pokud peer's value differs from my baseline ale peer field nemá v `_changed_fields` (tj. propagace shora, ne aktivní edit), neflagujeme konflikt — eliminuje další třídu false-positives kdy cloud už dorazil mou edit zpět k peerovi
- **P2P delete propagation** — bundle teď exportuje i soft-deleted rows (s `_deleted_at`). Příjemce aplikuje tombstone (Case 1b v `mergeRowPerField`); local-delete vs peer-alive = local wins (Case 1c). Eliminuje "zombie" rows co by se vrátily přes P2P
- **Two-phase commit P2P review** — exchange bundles → both peers preview proposed changes → both must independently Accept před actual apply. Reject from either cancels both. Disconnect during exchange = cancellation. `previewSyncBundle()` dry-run helper. Message envelope `{type: BUNDLE|ACCEPT|REJECT}` na MCSession channel.
- **In-session conflict resolution picker** — pro každý field v `conflict_fields` se v review screenu místo diff bloků renderuje **MINE / THEIRS** picker (default = lokální hodnota). ACCEPT message nese `resolutions: P2PResolutions` map (`${table}:${rowId}:${field}` → chosen value). Při dorazení peer's ACCEPT se mapy porovnají; pokud souhlasí → `importSyncBundle(bundle, resolutions)` aplikuje agreed value a field se odstraní z `_changed_fields` (oba peers konvergují deterministicky), jinak `disagreed` phase s "Adjust picks" / "Cancel sync". Eliminuje nutnost po-sync trip do `/conflicts` pro běžný household use case.
- **Restored `app/(app)/p2p-sync.tsx`** z placeholder stavu na funkční flow (Hermes HBC bug obejit dynamic import workaroundem)

**Pending changes screen** (nový `app/(app)/pending.tsx`):
- Tap na sync status bar v offline/pending stavu → screen s grouped pending sync queue
- Resource icon (kategorie items / shippingbox boxes / house warehouses) + operation badge (zelený `+` insert / modrá tužka update / oranžový `−` delete)
- Per-field before → after diff (git-style red `−` / green `+` blocks)
- Multiple changes na 1 resource = 1 aggregated entry s "X edits combined" badge
- Tap na resource name → navigate na detail (router.replace, ne push, kvůli loop avoidance)
- Items získali `?itemId=` query param na box detail → ItemEditSheet auto-opens
- Per-entry **Revert** + global **Revert all** s before-snapshot z queue payload
- Box_id field zobrazuje "Box · Warehouse" místo UUIDs

**Conflicts screen redesign:**
- Stejný visual language jako pending (resource icon, git-diff style)
- Per-field tappable selection (Mine / Server) s `−` red / `+` green styling
- Selected option má thicker border + checkmark icon, unselected fade na 50% opacity
- Quick actions zachovány ("Keep all mine", "Take all server")

**Resource icons across the app:**
- Nový `<ResourceIcon>` komponent (`src/components/ResourceIcon.tsx`)
- Items: PNG kategorie ikony z `assets/icons/` (food-can, water-drop, medicine-pill, …) + `tag.png` fallback
- Boxes: SF Symbol `shippingbox.fill` v sage green
- Warehouses: SF Symbol `house.fill` v sage green
- Optional `statusDotColor` prop pro corner badge (např. expiry status)
- Optional operation badge (`ResourceOpBadge` / `ResourceIconWithOp`) — INSERT zelený, UPDATE modrý (palette.blue), DELETE oranžový
- Aplikováno: pending, conflicts, p2p preview, items list (box detail + cross-box items tab), boxes list (warehouse home), warehouses list (root)
- StatusDot v box detailu nahrazen ResourceIcon + corner status dot (expiry color)

**Never-expires items:**
- Sentinel ISO date `9999-12-31` (`NEVER_EXPIRES_DATE` v `types/database.ts`)
- `ExpiryStatus` rozšířen o `'never'`, neutrální grey color
- ItemEditSheet: segmented control "Has expiry / Never expires" — tap "Never" sets sentinel, tap "Has expiry" sets null
- `formatExpiry` rozpoznává sentinel → "Never"
- Pending/conflicts/P2P review formatValue → "Never" pro sentinel
- Sync engine passes through normálně (sentinel je jen date string), žádné schema změny

**Public website na kalta.app:**
- Astro 5 static site v `web/` subdirectory
- Inter font self-hosted přes fontsource (žádné Google Fonts tracking)
- Hero s box icon, 6 feature cards s Lucide SVG ikonama (MIT licence, ne SF Symbols kvůli Apple licensing pro web)
- 6 docs pages s sidebar nav + prev/next pagination + breadcrumb (`/docs/getting-started`, `/organizing`, `/scanning-and-ai`, `/expiry-and-reminders`, `/collaboration`, `/printing`)
- `/privacy`, `/terms`, `/support` — markdown imports z `docs/legal/` a `docs/support/`, single source of truth
- OG image generator (`scripts/generate-og.mjs` přes sharp), favicon generator (`scripts/generate-favicons.mjs` z app icon přes sharp + png-to-ico)
- Cloudflare Pages hosting přes wrangler CLI (po komplikacích s GitHub integrace UI změnou)
- Custom doména `kalta.app` aktivovaná, https + cert auto-vydaný
- realfavicongenerator checker: clean, žádné errors

**Legal & metadata docs (single source of truth markdown v `docs/`):**
- Privacy Policy 392 řádků GDPR-compliant — Data Controller (Ondřej Michalčík OSVČ Praha, IČO 04801792, DIČ CZ8801235993), kompletní processors list (Apple, Supabase Ireland, Open Food Facts France, Anthropic USA opt-in BYOK), legal basis Art. 6(1)(b)/(f)/(a), DSR rights, ÚOOÚ kontakt
- Terms of Service — paid app, Apple Standard EULA reference, P2P/sharing disclaimers, Czech governing law, IČO/DIČ
- Support FAQ refaktorován na troubleshooting-only (how-to obsah přesunut do `/docs/`)
- App Store listing copy — name "Kalta", subtitle "Home emergency stock tracker", description s key features, keywords (inventory, pantry, prepper, …), what's new, kategorie Utilities + Lifestyle
- App Privacy nutrition labels — "Data Linked to You" only, no tracking, no ATT prompt needed
- Apple review notes — "use your own Apple ID" (po failed plus-tag Apple ID create attempt)
- Paid app setup walkthrough — kompletní step-by-step pro App Store Connect (Paid Apps Agreement, W-8BEN s Article 12 royalties claim 0% rate, banking, contacts, SBP, Family Sharing, promo codes)

**App Store Connect progres:**
- Free Apps Agreement Active (od 12 Apr 2026)
- Paid Apps Agreement requested 2026-04-25 (status `New`), Name Identification Document uploaded (Výpis z živnostenského rejstříku z rzp.cz)
- Apple processuje identity verification 1-3 business days; Tax / Bank / Contacts sekce gated zatím
- App record ještě nevytvořený (čeká na Active Paid Apps Agreement)

**EAS Build pipeline:**
- Hit free tier limit (30 buildů/měsíc) po vícenásobných iteracích kolem rename + P2P fixes — upgrade na Production plan
- `eas.json` přepnut zpět na `appVersionSource: "remote"` + `autoIncrement: true` (eliminuje app.json modifikace, server-side counter)
- Env vars pushnuté do `preview` environment přes `eas env:push preview --path .env`
- Build 22 v TestFlight stable; Build 23 (s P2P review + in-session picker + pending + diff + sync v2 + image compression + Universal Links) pending

**Tech debt cleanup (na záver session):**
- **Image compression aggressive** — `src/lib/storage.ts` resize 800px@70% → **480px@60%** (~3× menší soubory, ~30–50 KB per item místo 80–150 KB). Šetří Supabase Storage cap; kvalita stále dostatečná pro thumbnail i full-screen view na mobile.
- **Universal Links** — `web/public/.well-known/apple-app-site-association` s Team ID `P59Z5SBM7N` + bundle ID + `applinks` components na `/invite/*`. Cloudflare Pages `_headers` zajišťuje `Content-Type: application/json` (Apple-required), `_redirects` rewrites `/invite/*` → `/invite` static fallback page. `app.json` `associatedDomains: ["applinks:kalta.app"]`. `buildInviteLink` teď generuje `https://kalta.app/invite/${token}` místo `kalta://` schemu — funguje i jako fallback link když user nemá appku, otevře landing page s "Coming to App Store".
- **Dev-only email/password login odstraněn** — `app/(auth)/login.tsx` byl `__DEV__` wrapped fallback bypass přes `supabase.auth.signInWithPassword`. V prod se nerenderoval (`__DEV__===false`), ale před App Store cleanupem ven kompletně. Login screen teď jen Apple Sign In + Continue offline.
- **Pending: revert disabled pro `inventory_lines`** — append-only audit data ze scan-and-count session; revert by audit corruptl. UI tlačítko skryté pro tento table.
- **Realtime self-event echo suppression** — nový `src/lib/realtimeEcho.ts` (5s sliding window tracker `(table, rowId, ts)`, max 200 entries). `enqueueChange` označí každý write přes `markRecentLocalWrite`; `subscribeBoxes` / `subscribeItems` / `subscribeMyWarehouses` v `supabase.ts` pak přes `isOwnEcho(payload)` ignorují server echo vlastních zápisů — eliminuje redundantní `load()` + re-render po každé lokální mutaci. Cross-device updates (manželčiny edity) projdou normálně, protože tracker je per-process.
- **Role-aware UI ověřeno** — destructive actions správně gated: `Delete warehouse` / member promote/demote/remove / Invite (settings.tsx, isOwner condition), `Delete box` (box action sheet, line 257). `Delete item` zůstává dostupný **všem členům** záměrně — household model (manželka maže snědené jídlo), RLS items_delete je `is_member()` ne `is_owner()`.

**Klíčová rozhodnutí:**
- **Tier 10 ($9.99)** místo dřívějšího plánu free/Tier 3. Důvod: Supabase hosting cost per active user. Tier 10 pokrývá ~2-3 roky hostingu z jednorázové platby.
- **App Store cesta místo TestFlight-only** definitively confirmed (TestFlight expiruje buildy po 90 dnech, prepper use case potřebuje persistent install)
- **Two-phase commit P2P** > immediate apply. User explicitně chtěl review-then-accept flow, ne fire-and-forget.
- **In-session conflict picker default = MINE** — bezpečný default (přijetí beze změny zachová moje editace); pro shodu s peerem musí někdo aktivně flipnout na "Theirs". Vede k explicit user-driven konvergenci místo arbitrární resolution strategy. Symetrický algoritmus (oba peers porovnají stejným způsobem) zaručuje, že disagreement screen naběhne na obou stranách současně.
- **Sentinel date pro never-expires** > schema column. Žádná migrace, sync engine neutrální, UI rozezná lokálně.
- **Universal Links přes web doménu** > custom URL scheme. `kalta://invite/...` je fragile (collision risk, žádný browser fallback), `https://kalta.app/invite/...` má jak iOS native handover (AASA), tak graceful web fallback pokud appka chybí.
- **Cloudflare Pages over GitHub Pages** kvůli kalta.app DNS already on CF (one-click custom domain).
- **Lucide SVG icons na webu** místo SF Symbols (Apple licensing forbids SF Symbols mimo Apple platforms marketing).
- **PNG kategorie ikony pro items** v listech vs SF Symbols pro chrome — odpovídá designu z assets/icons/ Sprintu 2.5.

**Otevřené drobnosti:**
- `inventory_lines` revert v pending screen je no-op (append-only data, nedá se "undo")
- Multiple stacked UPDATEs pro 1 row + revert nejstaršího UPDATE → newer entries' before-snapshots zůstávají, ale visual-only zmatení (data integrity OK)
- ✅ ~~Image storage cap per user~~ — vyřešeno: kompresí 480px@60% (viz Tech debt cleanup výše)

### Session 2026-04-19 — P2P crash deep-dive, attention banner, Hermes bisect

Post-build-18 den plný debuggingu TestFlight crashe. **Výsledek: P2P sync dočasně vypnutý jako placeholder, zbytek appky stabilní.** Sprint 5 App Store release je odblokovaný.

**Attention banner na Warehouses list:**
- User postřeh: "badge na ikoně ukazuje číslo, ale když appku otevřu, tak mi nic neukáže o čem ten badge je"
- Přidán 3-tier banner: červený (≤1d), žlutý (≤30d), sage (≤60d), dole podle nejurgentnější skupiny
- Badge count = items expirující v ≤60 dnech (user chtěl zachovat 60d threshold)
- `src/lib/notifications.ts:setAppBadge()` helper pro live update bez full reschedule
- Tap banner → `/alerts/[window]` a clear badge

**Oprava `.gitignore` — kritická:**
- Pravidlo `ios/` (bez leading slash) ignorovalo **všechny** `ios/` adresáře v tree, nejen root. Znamenalo to že náš **custom Swift modul `modules/stockr-multipeer/ios/`** nebyl v gitu a pravděpodobně ani v EAS Build uploadu. Fix: změna na `/ios/` (anchored na root). Swift zdrojáky + podspec přidány do gitu (sprint 5 commit #2).

**`expo.autolinking.nativeModulesDir` fix:**
- `npx expo-modules-autolinking resolve -p ios` nevracel stockr-multipeer. Expo neskenuje `modules/` directory defaultně — pouze `node_modules/`.
- Fix: `"expo": { "autolinking": { "nativeModulesDir": "./modules" } }` v `package.json`
- Po fixu autolinking vrací `podName: 'StockrMultipeer'`, `swiftModuleNames: ['StockrMultipeer']`, `modules: [{ class: 'StockrMultipeerModule' }]` → modul pak v podfile/xcode buildu

**P2P sync crash — bisect přes 10+ TestFlight buildů / OTA updates:**

Posloupnost crashů a jejich diagnóz:
- **Build 16:** `EXC_CRASH SIGABRT` v `ObjCTurboModule::performVoidMethodInvocation` (ObjC NSException ze Swift MCP kódu). Teorie: `MCPeerID(displayName:)` s empty/long string nebo `MCNearbyServiceBrowser` bez NSBonjourServices. Fix: Info.plist (přidání `_stockr-sync._tcp/_udp`), Swift validace displayName.
- **Build 17/18:** crash na startup 4s po launchi v `expo-updates` `ErrorRecovery.crash()`. Teorie: OTA bundle nekompatibilní s native. Po reinstallu padalo **i offline** → bug v embedded bundle, ne OTA cache.
- **Autolinking fix → Build 19:** crash přesunut do `hermes::vm::stringPrototypeIncludesOrStartsWith` (EXC_BAD_ACCESS v Hermes při `.includes()` call). Defensive `String(e.message ?? '').includes(...)` coercion.
- **Build 19 + OTA chain:** další crash v `hermes::vm::errorStackGetter` — Hermes při tvorbě `.stack` Error objektu. Exhausted attempts → temporary placeholder P2P screen.

**Bisect při znovu zapínání (A1 → A10):**
- A1 auto-push ✅ / A2 urgency iteration ✅ / A3 side-effect import ✅ / A5 minimal state ✅ / A6 +useEffect+refs ✅ / A7 all state+callbacks no native ✅ 
- **A8/A8b/A8c/A9:** jakákoli statická reference `Multipeer.startSession` (i `Multipeer['startSession']` bracket access, i pouhé `typeof Multipeer.startSession`) **v useCallback closure body** → **crash na mount screenu**. Hermes HBC bug — bytecode generace pro module-member access v closure je broken.
- **A10 dynamic import:** `const mod = await import(...)` v handler body prošel, screen naběhl, `mod.startSession(displayName)` **padl v native vrstvě** → to je druhý, nezávislý problém ve Swift MCP kódu

**Závěr:**
1. **Hermes HBC bug** — workaroundable dynamic importem. Worth filing upstream.
2. **Native Swift MCP crash** — neladitelný z JS/TestFlight. Potřebuje `npx expo run:ios --device` + Xcode Console s live Swift/MCP stack tracem. Odloženo na samostatnou session.

**Co zůstalo v kódu:**
- P2P screen = placeholder "Temporarily disabled"
- `modules/stockr-multipeer/` a `src/lib/p2pSync.ts` — netknuté, žádný import z screenu
- `app.json` NSBonjourServices + Info.plist NSBonjourServices + Swift validace displayName — jsou v buildu pro až P2P znovu zapneme
- `expo.autolinking.nativeModulesDir` — zůstává, modul bude k dispozici v buildech

**Sprint 5 status:** všechno ostatní stabilní, core flows otestované na reálných zařízeních (invite, offline, sync, filter, notifications, badge/banner). Next: privacy policy → App Store metadata → submit.

---

### Session 2026-04-18 — post-TestFlight bug-fix pass

TestFlight build 16 uploaded, první reálný multi-device test odhalil hromadu edge-case bugů napříč auth / sync / P2P / UI. Všechny vyřešené, jde se pro build 17.

**Invite accept flow — 3 vrstvy bugů:**
- **RLS chicken-and-egg** — `invitations_select` policy vyžaduje `is_member(warehouse_id)`, ale pozvaný ještě členem není → první SELECT v `acceptInvitation` vracel null → klient hodil "Invitation not found" → pozvánka se nikdy neaplikovala. Fix: přidán **SECURITY DEFINER RPC `public.accept_invitation(invite_token uuid)`** v `schema.sql` který obchází RLS a atomicky validuje token + vloží membership + označí pozvánku za použitou. Klient volá RPC místo direct table queries.
- **Deep link parsing** — `stockr://invite/TOKEN` parsuje v expo-linking jako `hostname="invite", path="TOKEN"`. Regex `^invite/(.+)$` nikdy nematchoval → handler nic nedělal → žádný feedback ani error. Fix: zohlednit obě shapes (`hostname=invite` i `path=invite/…`).
- **SQLite persistence** — po úspěšném server insertu klient nic nezapsal do lokální DB, takže po return na `/` seznam warehouses (čtený z SQLite přes `getMyWarehousesLocal`) byl pořád prázdný. Fix: `acceptInvitation` teď po RPC zapisuje warehouse + membership + boxes + items + ostatní členy + jejich user profily do SQLite.

**Sync engine:**
- **Pending counter nemizel** — `pushSync` běžel jen při app startu / reconnect. Auto-trigger po mutacích chyběl → queue entry zůstávala po každém writu navždy. Fix: **debounced `scheduleAutoPush` v `enqueueChange`** (500ms) — každý write automaticky naplánuje push, batch writes se coalesce do jednoho cyklu. Plus error surface (tap na lištu "1 pending change" otevře alert s posledním push errorem).
- **`custom_products` duplicate key crash** — pushSync dělal `upsert` s default `onConflict=PK(id)`, ale produkty mají unique key `(warehouse_id, barcode)`. Když oba kliente naskenovali stejný barcode, dostali různé id ale stejný logický row → PG unique violation → záznam navždy v queue. Fix: per-table conflict override, pro `custom_products` předává `onConflict: 'warehouse_id,barcode'`.
- **Konflikty se ztrácely** — `runSyncCycle` volal push→pull. Push přepsal server Ondřejovým offline editem, pull pak proti serveru neviděl rozdíl = žádný conflict. Fix: **swap na pull→push** + `pushSync` přeskočí entries, pro které je nevyřešený conflict v `_conflicts`. Konflikt se teď korektně uloží a user dostane červenou lištu "1 sync conflict to resolve".

**Members list** — `initialFullSync` stahoval z `warehouse_members` jen self-row (`eq('user_id', userId)`). Settings screen pak viděl jen přihlášeného usera, ne ostatní členy. Fix: fetch všech členů pro user's warehouses + backfill i v `pullSync` (snapshot-replace) a v `acceptInvitation`.

**Sign-out + offline continue — 4 na sebe navázané bugy:**
- **Sign out nepůsobil** — handler čistil jen supabase session, ale `cachedUser` state (offline fallback) zůstával → auth guard pořád viděl user autentizovaného. Fix: SIGNED_OUT handler v `_layout.tsx` čistí i `cachedUser`.
- **Involuntary SIGNED_OUT** — offline token refresh fail taky emituje SIGNED_OUT → můj fix navíc uživatele vyhazoval z appky. Fix: `signOut()` nastaví flag `_explicitSignOut=true`, handler čistí `cachedUser` jen když flag consume ne-false.
- **Offline signOut hang** — `supabase.auth.signOut()` default scope='global' posílá revoke request serveru. Offline to viselo. Fix: `scope: 'local'`.
- **Continue offline nepropadlo** — `handleContinueOffline` zapsal `CACHED_USER_KEY` do AsyncStorage, ale `_layout.tsx`'s React state `cachedUser` se o tom nedozvěděl → auth guard viděl null → redirect zpět. Fix: `src/lib/authBridge.ts` — tiny pub-sub, login emituje, _layout poslouchá. Plus `router.replace('/')` odebrán — auth guard naviguje sám když state updatne (odstraněn race mezi `setCachedUser` a `router.replace`).

**Screens používající session — 14 míst:**
Všechny screeny volaly `supabase.auth.getSession()` pro userId. V offline módu (Continue offline) session je null → fallback na cachedUser chyběl → screens viděly prázdno / "Warehouse not found". Přidány helpery `getActiveUserId()` / `getActiveUser()` (session first, AsyncStorage fallback), aplikovány napříč: warehouses list, profile, `(app)/_layout.tsx`, warehouse settings, box detail, add-items, inventory, products, new warehouse, P2P sync, ItemEditSheet, openOneItem.

Plus: `pullSync` má teď **session guard** — pokud není auth session, vrátí no-op. Bez toho RLS silently filtroval `.select()` na `[]` a můj "replace members snapshot" kód mazal všechny členství lokálně.

**Profile identity** — čte email/display_name z lokální `users` SQLite tabulky (offline případ) + online refresh. Přidán "Contact email" override (pencil icon, tap → Alert.prompt) pro uživatele s Apple "Hide My Email" relay adresou.

**Notifikace redesign:**
- Windows **30/7/1/0 → 60/30/1** (user-requested)
- **Grouped per (window, crossing day)** místo per-item-per-window — max 3 notifikace denně, body = seznam jmen
- Nová obrazovka **`app/(app)/alerts/[window].tsx`** — tap na notifikaci otevře filtrovaný seznam cross-warehouse, sort podle urgency, row s pill "Xd" / "today" / "Xd overdue"

**Filter UX redesign (Items tab, Box detail, Boxes tab):**
- 3 horizontální scroll-chip řady → **bottom sheet modal** (`src/components/FilterSheet.tsx`) + **ActiveFilterChips** nad seznamem (tap × clear) + badge + primary tint na filter ikoně
- `ListHeaderAction` rozšířen o `badge` a `active` props
- **Status** sekce: day-window buckety `Any / Expired / ≤1d / ≤30d / ≤60d / OK (60+) / No date` — **perfektní shoda s notifikačními okny**, nový helper `matchesExpiryFilter`. `ExpiryStatus` enum netknutý (barvy/sort). Přidán helper `matchesCategoryFilter` / `matchesConditionFilter` ve stejném souboru.
- **Condition** sekce (dřív "Packs") — multi-select **Opened / Damaged / Has note** s OR sémantikou (item prošel pokud splňuje aspoň jeden flag — typické "attention" flagy). Stará `OpenedFilter` odstraněna.
- **Category** sekce — multi-select checkboxes (dřív single radio). Active chip buď jméno (1 selected) nebo "N categories".
- `FilterSheet` má `sections` prop (`'status' | 'condition' | 'category'`) — Boxes tab používá jen `['status']`.

**P2P sync crash (nejtěžší případ):**
- Uživatel: "tap na Start searching → instant crash". TestFlight build 16 crashlog: `EXC_CRASH(SIGABRT)` → `objc_exception_rethrow` v `ObjCTurboModule::performVoidMethodInvocation`. Tedy NSException z native turbo-module invocation.
- Pravá příčina: **`ios/Stockr/Info.plist` měl jen `<string>_expo._tcp</string>` v `NSBonjourServices`** — náš `_stockr-sync._tcp/_udp` chyběl. `expo-dev-launcher` config plugin při prebuildu přepsal hodnotu z `app.json`. Když `MCNearbyServiceBrowser(serviceType: "stockr-sync")` startoval, iOS 14+ kontroluje deklaraci v Info.plist → **`NSInvalidArgumentException` (uncatchable ve Swiftu)** → abort.
- Fix: přidán `_stockr-sync._tcp` + `_stockr-sync._udp` do Info.plist přímo + sjednoceny `NSLocalNetworkUsageDescription` a `NSBluetooth*UsageDescription` (byly stále z dev-launcher defaults). `app.json` ses tím sladil (přidán `_expo._tcp` do `NSBonjourServices`) pro budoucí prebuild resilience.
- Defensive additions (nezpůsobily crash, ale předejdou budoucím edge cases): Swift `startSession` teď validuje `displayName` (non-empty, ≤63 bytes UTF-8) — při nevalidním vstupu throw JS error místo `MCPeerID` NSException crashe. JS truncate display name na 30 chars.

**Klíčová rozhodnutí této session:**
- **Buckety napříč appkou sjednocené** na day-window model (60/30/1). Notifikace, alerts screen, filter status — všechny mluví stejným jazykem. `ExpiryStatus` enum zůstává separátní pro vizuální barvy (různé thresholdy dávají smysl pro UX v kartách).
- **Filter UX jednotný přes 3 screeny** — Items / Box detail / Boxes tab používají stejný `FilterSheet` komponentu jen s jinou sadou sekcí. Konzistence > minimalismus.
- **authBridge event pattern** místo globálního store — malá pub-sub pro kros-screen state updates v edge case Continue offline → auth guard. Jednodušší než Zustand pro jedno-use-case.
- **RPC pro chicken-and-egg RLS** — stejný pattern jako `create_warehouse_for_me`. Jediná cesta jak nemember může číst/psát invitations tabulku bez otevírání RLS dokořán.
- **Info.plist direct edit > config plugin** — dev-launcher plugin overwrite nás vždy přepere. Edit committed Info.plist je source of truth, `app.json` NSBonjourServices sladěn pro defensive prebuild resilience.

**Pending (čeká na build 17):**
- Native rebuild (`eas build --profile preview --platform ios`) — Info.plist fix a Swift displayName validace jsou native changes, OTA update je nedoručí.
- Test na dvou zařízeních: invite accept flow, offline sign-out+continue, P2P sync after build 17.
- Volitelně: přidat ObjC try/catch wrapper kolem MCP setupu pro chyt ostatních NSException scenarios (permission denied runtime error atd).

---

### Session 2026-04-15 + 2026-04-16 — Sprint 3 UZAVŘEN + features

**2026-04-15**: Image upload pipeline + Claude Vision + Brother print prototype + TestFlight build pipeline + Brother SDK integrace.
**2026-04-16**: Brother print test na reálném hardware (rotation fix, QR bez loga), search + filter, move items, box inventura, UI polish.

- **Sprint 3A — Image upload do Storage**: `expo-image-picker` + `expo-image-manipulator` + `expo-file-system` installed. `src/lib/storage.ts` s upload pipeline používající **new File API** místo broken `fetch+blob` (classic RN gotcha — `fetch(uri).blob()` produkoval prázdný/bílý soubor). Resize 800px width + 70% JPEG = ~80–150 KB per image. Storage RLS policies na `storage.objects` (public select, authenticated writes). `ItemEditSheet` má thumbnail tile nahoře s `ActionSheetIOS` picker. `deleteProductImage` helper s safe no-op pro external (OFF) URLs.
- **Sprint 3B — Picker v add-items.tsx**: stejný pattern jako ItemEditSheet, ale wrapuje existující image/placeholder v Pressable. Empty state má "Tap to add photo" hint + category ikonu. `handleAddToQueue` blokuje Save během uploadu.
- **Sprint 3C — Claude Vision**: kompletní architektural pivot od původního plánu (Supabase Edge Function → direct client call s per-user key). Důvody a implementace viz Sprint 3 plan section výše. Path A (auto na OFF 404) + Path B (manual "✨ Identify with AI" button) + shelf life hint (ne prefill) + custom_products caching.
- **Sprint 3D — Brother print prototype**: hardware-independent Phase 1. `qrLabel.ts` generuje 80×24mm PDF přes `printToFileAsync` → `printAsync(uri)` two-step (direct HTML path iOS ignoroval a defaultil na A4). Dynamic font sizing podle `computeNameFontSize` heuristiky (54mm / chars × 0.62 char-ratio, floor 2mm, max 10mm) s center align. QR obsahuje zaoblené logo bedny v 7.5mm tile — asset `label-logo.png` (nano banana 3D crate) prošel Python PIL pipeline (auto-crop bbox detection, Gemini watermark removal z bottom-right, background clean-up threshold ≥230 → pure white, 8px rounded rect border 38px radius baked-in). Error correction H pro scanner reliability. `printBoxLabel` + `shareBoxLabelPdf` helpery napojené v `LabelModalContent` + post-create QR preview. In-app QR views (`react-native-qrcode-svg`) používají stejný asset pro visual consistency.
- **Sprint 3E — TestFlight build pipeline**: `eas-cli` + Expo account + `eas.json` s preview profilem (distribution: store, autoIncrement buildNumber, channel preview, env preview) + `appVersionSource: remote` pro EAS-managed versioning. `app.json` `ios.buildNumber: "1"` + `ITSAppUsesNonExemptEncryption: false`. EAS env vars (Supabase URL + publishable key jako plaintext v preview env — jsou stejně EXPO_PUBLIC_* bundled). First build interactive credentials setup (Apple ID + 2FA → EAS auto-generated Distribution Cert + Provisioning Profile uloženo na EAS server). `eas submit` auto-vytvořil App Store Connect record (ASC App ID 6762301537) + App Store Connect API Key. TestFlight Internal Testing group Family s auto-distribution, build naskočil v TestFlight app na iPhonu bez email invite (internal testers přímo vidí app). Apple Sign In funguje na real device.
- **Sprint 3F — Brother SDK integrace** (IN PROGRESS, čeká na build): iOS system print dialog Bluetooth tiskárny nevidí (scanuje AirPrint přes Bonjour/WiFi). Brother iPrint&Label + P-touch Design&Print 2 apps nepřijímají žádné file imports (PDF ani PNG přes share sheet hází "Cannot share files"). Jediná funkční cesta = direct Brother Mobile Print SDK integrace. Zjištěno že existuje `expo-brother-printer-sdk@0.7.0` (rakeshta), Expo-compatible wrapper nad Brother xcframework — ale defaultně supports jen QL series. Solution: **patch-package workflow**. Patch `SettingsUtils.swift` přidává PT series support s novým `_parseSettings_PTSeries` co vytvoří `BRLMPTPrintSettings(defaultPrintSettingsWith: model)` (24mm TZe = labelSize index 5) + `_printerModelFromName` rozšířen o PT-P710BT + 16 dalších PT modelů. `postinstall: patch-package` v package.json zajišťuje že EAS cloud build re-aplikuje patch při `npm install`. `printBoxLabelViaBrotherSDK` flow v qrLabel.ts: generate PDF → `searchBluetoothPrinters()` → prefer PT-series channel → `printPDF(uri, channel, settings)`. 3 print buttony v LabelModalContent (Print to Brother primary / AirPrint / other secondary / Save PDF tertiary). **Rotation gotcha**: Brother SDK treats PDF width jako tape width, landscape PDF → 0.3× scale → miniature print. Fix: portrait PDF (24×80mm) + content rotated 90° via `transform: translate(-50%, -50%) rotate(90deg)` na `.label`. Waiting on EAS build queue.

**Klíčová rozhodnutí této session**:
- **Per-device API klíč v SecureStore** je bezpečnější než shared Edge Function secret (nulový leak risk v TestFlight binary) a každý user platí svoje volání. Claude Code / Claude Pro subscription NELZE použít pro mobile API calls — je vázaná na OAuth CLI session.
- **Haiku 4.5** jako default model (~$0.002 per identifikace, $0.20/měsíc pro typické použití), model je 1-řádkový swap na Sonnet pokud accuracy bude slabá.
- **Shelf life jen jako hint**, ne auto-prefill datumu — user musí verifikovat obalový nápis. Claude returns typical_shelf_life_days, hint se zobrazí jen když datum není vyplněné.
- **Prompt caching** na tool definition přes `cache_control: ephemeral` — šetří tokeny při batch scanningu v 5-min okně.
- **`pack_count` + `formatItemQuantity`** jako finální shape pro "balení" UI — viz 2.7 session note. Sprint 3 nemění.
- **`fetch(uri).blob()` v React Native je broken pro Supabase Storage upload** — pivot na `new File(uri).arrayBuffer()` (expo-file-system SDK 55+). Zaznamenávám pro budoucí gotchas.
- **`expo-print` na iOS ignoruje `@page` CSS při přímém HTML input** — always defaultí na A4/Letter. Fix: two-step `printToFileAsync({ html, width, height })` → `printAsync({ uri })`. PDF má exact embedded page size v metadata a print dialog to respektuje. Zaznamenávám pro budoucí print work.
- **QR logo overlay na ECC-H**: 30% area damage tolerance v teorii, ale praktická safe zone pro center overlay je ~25% area = ~50% width. Aktuálně 7.5mm/18mm ≈ 42% width = 17% area → komfortní margin.
- **Python PIL pipeline pro asset preprocessing** — auto-crop bbox, watermark removal, background clean-up, baked-in borders. Lepší než runtime manipulation pro static assety. Zachováno jako jednorázový script (není v repo, dá se rekonstruovat z commit history pokud by bylo potřeba).
- **TestFlight internal testers dostávají mail jen někdy** — pro internal je výchozí behavior že app naskočí přímo v TestFlight appce na iPhonu s matching iCloud Apple ID. Pozvánkový email je optional flow pro external testers. V našem případě iCloud Apple ID na iPhonu musí být registrovaný jako ASC user v Active state (Pending=neviditelné).
- **Brother PT-P710BT ecosystem je dysfunkční pro developer integrace** — iOS system print dialog Bluetooth tiskárny nevidí, Brother consumer apps (iPrint&Label, Design&Print 2) nepřijímají žádné file imports, share sheet hází "Cannot share files" ani pro PNG/JPEG. Jediná cesta = direct SDK integration. Pro vendor lock-in z pohledu devs nepříjemné, ale jakmile to funguje, UX je one-tap print z aplikace.
- **patch-package pattern pro node_modules modifikace** — dobrá volba když máme funkční upstream knihovnu ale chybí jedno konkrétní supported scenario. `postinstall` hook garantuje auto-apply při `npm install`, takže funguje i v EAS cloud builds. Patch souborové je v git repu (`patches/expo-brother-printer-sdk+0.7.0.patch`), survives updaty, dá se kdykoli regenerovat `npx patch-package <name>`.
- **Swift Obj-C enum renames jsou nepredictable** — `BRLMPrinterModelPT_P715eBT` Swift import jako `.pt_P715eBT` (lowercase) kvůli lowercase `e` uprostřed ruší acronym heuristiku. Ostatní `BRLMPrinterModelPT_XXXBT` zůstávají `.PT_XXXBT`. Build fail je single line fix ale debug z první je nepříjemný.
- **STRATEGICKÁ ZMĚNA — TestFlight → App Store cesta + offline-first priorita**: TestFlight expiruje buildy po 90 dnech což je inkompatibilní s prepper emergency use case (appka musí fungovat i bez internetu navždy). App Store publikace je long-term target. Parallelně datový layer přejde na **local-first** (local SQLite + Supabase sync) — podrobný návrh v Sprintu 4' sekci výše. Tohle je velká architectural change co postpones pushnotify sprint (4) za offline-first sprint (4').

**Otevřené drobnosti** (non-blocking):
- Orphan cleanup v storage (cancelled drafts s uploadedem foto). Defer.
- `visionEnabled` se čte jen na mount v add-items — pokud user nastaví klíč mid-session na Profile a hned skočí scan, refresh neproběhne (screen je v různé stack entry). Acceptable; fix přidat `useFocusEffect`.
- Brother print full test na reálném hardware — EAS build s rotation fixem je v queue, real print test s 20mm QR (no logo, ECC-M) ještě neproběhl.

**Session 2026-04-16 — nové features:**

- **Search + filter**: Boxes tab má inline search bar (name + location) + status filter chips (All/Expired/Critical/Soon/OK/None). Items tab má search (name + box) + 3 řady filtrů (expiry status, opened/sealed, category). AND logika, counter v subtitle "X of Y".
- **Move items mezi boxy**: unified `moveItemQuantity(id, qty|'all', targetBoxId, userId)` s merge logikou (matching item v target boxu = přičtení qty místo duplicity). Match criteria: name+barcode+expiry+category+unit+pack_count+opened. Single-item move z ItemEditSheet (s partial qty prompt přes Alert.prompt). Multi-select batch move z box detail ActionSheet "Select & move items" → checkboxy → BoxPicker modal → quantity confirmation sheet s per-item −/+/input stepper → execute. Nový `src/components/BoxPicker.tsx` reusable komponent.
- **DB trigger fix**: `recalc_box_cache()` teď recalkuluje OBOJÍ boxy (source i target) při item move (`old.box_id IS DISTINCT FROM new.box_id`). Realtime fix: force `load()` po move protože Supabase realtime filter `box_id=eq.X` nefire pro items opouštějící box (NEW row nematchuje starý filter).
- **Box inventura (scan & count)**: Nová route `box/[boxId]/inventory.tsx`. Plný workflow: scan items jeden po jedném (každý scan = +1), nebo scan jednou + ručně zadat počet. Opened toggle per scanned item. Manual picker pro damaged/nečitelné barcódy. Progress bar "X of Y scanned". Report fáze: summary (Full/Partial/Missing), found items s "Found X of Y" detail, NOT FOUND section. Při confirm: 3-option alert pro missing items (Go back / Keep in box / Remove missing). Reconciliation: foundQty>0 → update DB quantity+opened, foundQty=0 → DELETE item z DB, missing+remove → DELETE. `inventory_sessions` + `inventory_lines` tabulky s RLS (včetně UPDATE policy — bez ní `completed_at` update tiše selhával). `found_quantity` column pro per-item counting. Status enum: found/partial/missing. History screen `box/[boxId]/inventories.tsx` s expandable session detail (lazy-loaded lines).
- **Date picker fix**: `themeVariant="light"` na obou DateTimePicker instancích (ItemEditSheet + add-items). Řeší invisible calendar days na iOS light theme.
- **QR label improvements**: QR zvětšen 18→20mm, logo odstraněno z tisku (zůstává v in-app views), ECC H→M (méně modulů = větší per-module = lepší scan). Portrait PDF 24×80mm s CSS rotation fix (Brother SDK treats PDF width jako tape width). Body explicit pt dimensions + `page-break-after: avoid` → 1 stránka.
- **Post-create screen redesign**: success checkmark header, "Box created" title, button hierarchy (Print to Brother primary → Open detail secondary → Back tertiary), UUID skrytý, víc vzduchu.
- **Expiry label cleanup**: `formatExpiry` zjednodušen na kompaktní formát (`Expired` / `Today` / `Tomorrow` / `15d` / `2 mo` / `1 yr` / `No date`). Barvy zjednodušeny na 3+1: červená (expired) → žlutá (≤3 mo, critical+soon merged) → zelená (>3 mo) → šedá (no date). Sort priority zůstává 5-úrovňový.

**Klíčová rozhodnutí 2026-04-16**:
- **Move s merge**: když přesuneš item do boxu kde už stejný produkt je, qty se přičte (ne duplicate). Matching je strict (8 polí) ale NULL==NULL přes coalesce — konzistentní s `open_one_item` RPC.
- **Inventura = source of truth**: scan & count nahrazuje DB quantities. Explicitní 3-way choice pro missing items (keep/remove/go back). Qty=0 = delete z DB.
- **Brother print QR bez loga**: na 180 DPI thermal tape je logo overlay příliš agresivní pro scan reliability. Logo zůstává v in-app QR views (screen resolution je neomezená).
- **Supabase RLS gotcha**: chybějící UPDATE policy → tiché selhání (0 rows affected, no error). Vždy audit že pro každou tabulku s RLS existují ALL čtyři policies (SELECT/INSERT/UPDATE/DELETE) pokud je potřebujeme.

### Session 2026-04-14 — Sprint 2.7 UZAVŘEN ✅

Multi-warehouse první-class resource + role-aware UI + opened-split workflow:

- **Fáze 1 Schema**: `invitations.email` nullable + `role in ('member','owner')`, DB trigger `enforce_at_least_one_owner()` (≥1 owner invariant přes `warehouse_members_one_owner`), RLS `members_update` policy (owneři můžou promote/demote), `items.opened` boolean + `items.pack_count` int columns, nové API `getMyWarehouses`/`getWarehouseById`/`renameWarehouse`/`deleteWarehouse`/`leaveWarehouse`/`promoteMember`/`demoteMember`/`removeMember`/`subscribeMyWarehouses`/`openOneItem`, `createInvitation` rozšířen o `role` parameter, `acceptInvitation` respektuje `inv.role`
- **Fáze 2 Route restructure**: `(tabs)/*` a `box/*` přesunuty pod `warehouse/[warehouseId]/...`, nový root `app/(app)/index.tsx`, scan.tsx navigate na `box.warehouse_id` (ne URL param), settings tab používá `useGlobalSearchParams` (local nevrací parent dyn params v nested tabs po tab switchi), `ensureWarehouse` odstraněno z login.tsx
- **Fáze 3 Warehouses list**: empty state s `box-generic` brand icon + primary CTA, pill cards s role badge (Owner sage / Member neutral), `person.crop.circle` profile icon → Sign out alert, FAB `+ New warehouse`, realtime sub na `warehouse_members` filtered by user
- **Fáze 4 Create warehouse form**: jednoduchá name input form → RPC `create_warehouse_for_me` → `router.replace('/warehouse/${id}')`
- **Fáze 5 Warehouse settings**: rename přes `Alert.prompt` (iOS), members list s avatar kolečkem a role badge, per-member `ActionSheetIOS` (Promote/Demote/Remove, gated invariantem "not last owner"), destruktivní akce Delete (owner) / Leave (member nebo non-last-owner) s hint textem "You're the last owner…" pro disabled Leave
- **Fáze 6 Invitation flow**: Invite button v ListHeaderu (owner only), `InviteSheet` modal s dvoustavem (pre-generate toggle `Invite as co-owner` → post-generate copy/share/done), `Share.share()` nativní iOS sheet, deep link handler v `_layout.tsx` má `processInvite` extrahovaný a consuming path na `onAuthStateChange` — pending token v AsyncStorage pro pre-auth case
- **Fáze 7 Role-aware UI**: multi-owner model (`is_owner` kontroluje `warehouse_members.role='owner'`), badge na Warehouses list, podmíněné akce v settings
- **Fáze 8 Opened flag**: původně plánovaný `pack_size` experiment zrušen (neuchopitelná komplexita), místo toho `items.opened` boolean sort priority (opened-first **uvnitř** každé expiry group, ne globálně), nový helper `compareItemsByPriority`, orange "OPENED" badge v ItemRow/SwipeableRow/GridCard. Iterace: prvotní Switch toggle v ItemEditSheet → nakonec kompletně nahrazen RPC `open_one_item` split akcí atomicky (decrement/delete sealed + upsert opened sibling s strict match: `box+name+barcode+expiry+category+unit+pack_count`). Entry points: `SwipeableRow` renderLeftActions (amber swipe) + primary button v ItemEditSheet. Jen pro discrete units (pcs/pack).
- **Fáze 8 extras**: optional `items.pack_count` int pro "10 pcs · 24/pack" display (NE v title kvůli vizuálnímu collisi s `{qty} pcs` subtitle), nový helper `formatItemQuantity` konsoliduje všechny numeric info do subtitle lajny, `formatItemName` smazán
- **Fáze 9 Cleanup**: `getMyWarehouse` (singular) + `ensureWarehouse` smazány ze `supabase.ts` (žádné call sites), CLAUDE.md struktura projektu aktualizována

**Klíčová rozhodnutí této session**:
- Storage = first-class resource (onboarding, list, settings tab scoped na warehouse) místo single-warehouse assumption
- Multi-owner model > single owner transferable — reálný manželský use case
- Invite link share přes nativní `Share.share()` + deep link handler v root layoutu
- Terminologie zůstává `warehouse` v UI (Sprint 2.5 convention), ne rebranding na "storage"
- `pack_count` a `opened` evolved: pack_size → naming-based → pack_count optional display / opened flag → split action RPC. Každá iterace byla driven skutečným UX testováním v simulátoru
- `useGlobalSearchParams` v nested tabs — `useLocalSearchParams` v settings tab po tab switchi nevrací parent dyn params spolehlivě, global je bezpečnější default pro hluboce nested screenu

**Otevřené drobnosti** (non-blocking, můžou do Sprint 3 nebo samostatně):
- Items tab nemá realtime sub na `items` — manuální `load()` po open action. Sprint 3+.
- "Close / undo" akce na opened rows — zatím jen delete opened row manuálně. Later.
- Reálný test invite flow — potřebuje druhý Apple ID / TestFlight (Sprint 5).

### Session 2026-04-13 — Sprint 2.5 UZAVŘEN ✅

Kompletní refaktor UI vrstvy a technického základu:

- **Fáze 1 Tech debt**: Expo SDK 51 → 55 (React 19, RN 0.83, Reanimated 4), ChipRow null-guards, žádný patch-package potřeba
- **Fáze 2 Design system**: dark-first sage green paleta, typography/spacing/radius/shadows tokeny, `login-hero.png` + `screen-bg.png` generované přes PIL ze splash assetu, `<ScreenBackground>` wrapper aplikován na všech screens, native stack headery hidden + custom in-screen top bary
- **Fáze 3 Icons**: 32 ikon generovaných přes nano banana (sage 3D styl), chroma key fix opacity (|R-G|+|G-B|+|R-B| threshold + smooth alpha), resize na 512×512 (~9.5 MB total), `Icon.tsx` wrapper s 32-ikonovým registry, nahrazeny všechny emoji napříč screens
- **Fáze 4 Translation**: Category enum Czech→English + Unit ks→pcs/bal→pack, DB migrace idempotentní SQL script, všechny user-facing stringy přeloženy, `formatDateCs → formatDate`, date picker locale en-GB, default warehouse `Domácí sklad → Home`

**Klíčová rozhodnutí této session**:
- Dark mode across the whole app — gradient pozadí matching login screen
- Icon style: sage monochrome 3D rendering, generované po jedné přes nano banana
- DB rename Czech → English enums (migrace přes Supabase SQL editor)

**Otevřené drobnosti** (non-blocking, můžou do Sprintu 3 nebo samostatně):
- CZ komentáře v kódu (supabase.ts, některé screens) — postupně podle potřeby
- iOS ActionSheetIOS emoji (🏷 ✏️ 🗑) ponecháno — system limitation
- Role-aware UI (Sprint 4 territory)

### Poslední session před Sprint 2.5 (archive):
- **Stav**: Sprint 1 + 2 + všechny dodělávky kompletní, běží v iOS Simulator, schema.sql konsolidovaný
- **Known issues**: žádné blokující, jen tech debt (viz sekce)
