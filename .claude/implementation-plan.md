# Implementation plan – Stockr

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

## Sprint 2.6 – UI redesign (NoWaste style) 🚧

**Kontext:** Sprint 2.5 uzavřel dark frosted-glass theme napříč celou appkou. User po použití v kontextu zpětně odmítl tento směr pro utility screens ("z toho UI designu se mi líbí akorát ta login screen, zbytek jsem asi trochu přemyslel"). Login hero zůstává, zbytek redesign do clean light NoWaste-style — pill cards, tab bar, FAB, SF Symbols místo 3D custom ikon.

**Reference:** NoWaste food inventory app (Main Pantry detail screen uložený v `screen/nowaste_fridge_detail.png`).

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

## Sprint 3 – Tisk a AI ⏳

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

**Phase 2 — hardware test** ⏳ (až dorazí tiskárna)
- ⏳ Spárovat v iOS Settings → Bluetooth → ověřit AirPrint discovery
- ⏳ Reálný print na 24mm TZe tape + případné ladění CSS/layout podle skutečného výstupu (fontsize tuning, margins, QR scan reliability)
- ❌ Niimbot BLE protokol — zrušeno, AirPrint cesta je robustnější

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
- ⏳ Settings screen `settings/products.tsx` pro spravování custom DB — odložit do Sprint 4

---

## Sprint 4 – Sdílení a notifikace ⏳

### Pozvánky
- ⏳ `app/(app)/settings/index.tsx` — hlavní settings screen (přesunout dočasné "Odhlásit" z Dashboardu)
- ⏳ `app/(app)/settings/members.tsx` — seznam členů + pozvánkový formulář
- ⏳ `createInvitation` už existuje v API — UI zbývá
- ⏳ Sdílení linku `stockr://invite/{token}` přes `expo-sharing` (iMessage, Mail, Copy)
- ⏳ Deep link handler v `app/_layout.tsx` už parsuje path — otestovat real flow
- ⏳ Přijímač pozvánky: pokud user není přihlášen, persist token do SecureStore a zpracovat po loginu

### Role-aware UI
- ⏳ V `listMembers` / `getMyWarehouse` vrátit roli aktuálního usera
- ⏳ V `box/[id].tsx` action sheetu: pro member skrýt "Smazat bednu"
- ⏳ Testovat s druhým zařízením / Apple ID

### Push notifikace
- ⏳ `expo-notifications` setup (permissions, token registration)
- ⏳ Lokální scheduling po každém otevření appky (přečti items → naplánuj 30d/7d/same-day notifications)
- ⏳ Supabase Edge Function `daily-expiry-check` (cron trigger)
- ⏳ Settings pro zapnutí/vypnutí (opt-out)

### FIFO indikátor
- ⏳ Na dashboardu: na kartě bedny zobrazit "Otevřít první" pro tu s nejbližší expirací
- ⏳ Odlišit barvou/ikonou

---

## Sprint 5 – Release ⏳

### Assety
- ✅ `assets/icon.png` — 1024×1024, zelená paleta (nano banana generated)
- ✅ `assets/splash.png` — 1286×2778, stejná paleta, backgroundColor `#1E5F3E`
- ⏳ Případné zmenšení splash (z ~5.4 MB na <1 MB) — ImageOptim / pngquant
- ⏳ `assets/adaptive-icon.png` — foreground layer (prázdný pro iOS-only)

### TestFlight build
- ⏳ `eas.json` konfigurace (preview profile pro TestFlight)
- ⏳ `eas build --platform ios --profile preview`
- ⏳ `eas submit --platform ios` — upload na App Store Connect
- ⏳ Internal Testing group → pozvat manželku emailem
- ⏳ Test runtime na reálném zařízení (ne simulátoru)

### Polish
- ⏳ Accessibility labels pro screen reader
- ⏳ Dark mode (appka má zatím jen light)
- ⏳ iPad layout (pokud `supportsTablet: true` — zatím false)
- ⏳ Performance audit (React DevTools Profiler)
- ⏳ Odstranit dev-only email/password login z `login.tsx` před production buildem (`__DEV__` guard to už dělá automaticky)

### Dokumentace
- ⏳ README.md pro GitHub (pokud bude public repo)
- ⏳ Aktualizovat CLAUDE.md po Sprintu 5

---

## Technical debt

> **Pozn.:** patch-package a Expo SDK upgrade byly přesunuty do **Sprint 2.5** (Fáze 1 — Tech debt). Tahle sekce obsahuje jen zbývající položky.

### Role awareness (Sprint 4 territory, ale už se projevuje)
- Aktuálně UI zobrazuje destruktivní akce všem
- RLS policies to odmítnou, ale user dostane prázdný výsledek bez feedback
- **Fix:** v `listMembers` nebo v `getMyWarehouse` vrátit roli aktuálního usera a podmíněně renderovat tlačítka

### Refresh invalidace realtime
- Po `updateItem` v `ItemEditSheet` děláme optimistický update `setItems(prev.map(...))`
- Realtime subscription pak pošle event → znovu `load()` → zbytečný double refresh
- **Fix:** ignorovat vlastní write eventy (Supabase realtime má `eventId` per operation)
- **Priorita nízká** — race condition je kosmetická, UI se vrátí do konzistence do 200ms

### Settings screen + sign out
- Dashboard má dočasné "Odhlásit" tlačítko — ošklivé, ale funkční
- Přesunout do `settings/index.tsx` ve Sprintu 4

### Dev-only email/password login
- V `login.tsx` je `__DEV__` wrapped sekce s email/password fallback
- Slouží pro bypass Apple Sign In v simulátoru (password paste v iOS Settings nefunguje)
- **V production buildu se nerenderuje** (`__DEV__ === false`)
- Lze ponechat i do TestFlight buildu, ale doporučeno odstranit před App Store submission

### Error handling granularita
- Aktuální error states jsou jen na load level
- Save failures v editech jsou jen Alert (OK pro teď)
- Možná přidat retry-with-backoff pro síťové operace? — zvážit při prvním reálném použití

---

## Dependencies k dnešku

### Core
```json
"expo": "~51.0.28"
"react": "18.2.0"
"react-native": "0.74.5"
"typescript": "~5.3.3"
```

### Expo moduly
```
expo-router                 ~3.5.23
expo-apple-authentication   ~6.4.2
expo-camera                 ~15.0.16
expo-clipboard              ~6.0.3
expo-constants              ~16.0.2
expo-crypto                 ~13.0.2
expo-dev-client             ~4.0.23
expo-haptics                ~13.0.1
expo-linking                ~6.3.1
expo-secure-store           ~13.0.2
expo-splash-screen          ~0.27.5
expo-status-bar             ~1.12.1
expo-system-ui              ~3.0.7
```

### Third-party
```
@react-native-async-storage/async-storage     1.23.1
@react-native-community/datetimepicker        8.0.1
@supabase/supabase-js                         ^2.45.0
react-native-gesture-handler                  ~2.16.1
react-native-qrcode-svg                       ^6.3.0
react-native-reanimated                       ~3.10.1
react-native-safe-area-context                4.10.5
react-native-screens                          3.31.1
react-native-svg                              15.2.0
react-native-url-polyfill                     ^2.0.0
```

### Sprint 3 will add
```
expo-image-picker             (kamera foto / galerie)
expo-image-manipulator        (resize + compress před uploadem)
expo-print                    (Brother PT-P710BT přes AirPrint)
expo-sharing                  (fallback share PNG label)
```

### Sprint 4 will add
```
expo-notifications            (push)
```

---

## Aktuální stav prostředí

### Backend
- ✅ Supabase projekt vytvořený
- ✅ `schema.sql` spuštěný (plná konsolidovaná verze včetně RPC, realtime, storage bucket)
- ✅ Apple provider zapnutý v Supabase (Client ID: `com.ondrejmichalcik.stockr`, Allow users without email: ON)
- ✅ Test user `test@stockr.local` / `test1234` vytvořen pro dev bypass login
- ✅ Realtime replication enabled pro `boxes`, `items`, `warehouses`, `warehouse_members`
- ✅ Storage bucket `product-images` (public) vytvořený

### Frontend / Build
- ✅ `.env` vyplněný `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (nový publishable key, ne legacy anon)
- ✅ `npm install` proběhl
- ✅ Ruby 3.x nainstalovaný přes Homebrew, PATH v ~/.zshrc
- ✅ CocoaPods nainstalované přes `gem install cocoapods`
- ✅ `expo-dev-menu` patchnut v `node_modules` pro iOS 26 kompatibilitu (nepersistovaný)
- ✅ `npx expo prebuild --platform ios` proběhl
- ✅ První iOS build přes `npx expo run:ios` úspěšný
- ✅ Dev client běží v iOS Simulator (iPhone 17 Pro, iOS 26.4)
- ✅ Metro bundler connected, JS bundle loaded
- ✅ Sprint 1 + 2 funkčně ověřeny v simulátoru (login, dashboard, create box, QR label, add items, edit, delete, toggle view mode)

### Apple Developer
- ✅ Apple Developer Program aktivní
- ✅ App ID `com.ondrejmichalcik.stockr` registrován s capabilities:
  - Sign In with Apple
  - Push Notifications
- ⏳ Fyzický iPhone — nespárovaný s Xcode signing (čeká na setup)
- ⏳ Apple Sign In test na reálném zařízení (v simulátoru obejito přes dev bypass)

### Assety
- ✅ `assets/icon.png` — 1024×1024, zelená paleta, symbolizuje Stockr
- ✅ `assets/splash.png` — 1286×2778, stejný vizuál, backgroundColor `#1E5F3E`

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

Po otevření nové session a prozkoumání stavu:

1. **Zkontroluj, že Metro bundler naběhne a appka se spustí** — `npx expo start --dev-client` a v simulátoru reload
2. **Potvrď, že DB migrace ze Sprintu 3A běží** — `storage.objects` má 4 policies pro `product-images` bucket (select/insert/update/delete), předchozí Sprint 2.7 RPCs + triggery nezměněny
3. **Rozhodni, co dál**:
   - **Brother PT-P710BT tisk** — tiskárna objednaná 2026-04-14, až dorazí: `qrLabel.ts` HTML template + `expo-print` AirPrint test. Prototyp HTML se dá připravit i bez hardware.
   - **Sprint 4 (sdílení + notifikace)** — pozvánky už jsou z 2.7 hotové, zbývá push notifikace přes `expo-notifications` + Supabase Edge Function cron pro daily-expiry-check
   - **TestFlight distribuce (Sprint 5)** — EAS build pipeline, real-device test s druhým Apple ID
   - **Storage orphan cleanup** — nízká priorita, pokud začne být prostor problém

### Session 2026-04-15 — Sprint 3A/B/C/D UZAVŘEN ✅

Image upload pipeline + Claude Vision identifikace + Brother print prototype (hardware-independent Phase 1). Sprint 3 zbývá jen reálný print test s hardwarem (Phase 2 — až dorazí tiskárna).

- **Sprint 3A — Image upload do Storage**: `expo-image-picker` + `expo-image-manipulator` + `expo-file-system` installed. `src/lib/storage.ts` s upload pipeline používající **new File API** místo broken `fetch+blob` (classic RN gotcha — `fetch(uri).blob()` produkoval prázdný/bílý soubor). Resize 800px width + 70% JPEG = ~80–150 KB per image. Storage RLS policies na `storage.objects` (public select, authenticated writes). `ItemEditSheet` má thumbnail tile nahoře s `ActionSheetIOS` picker. `deleteProductImage` helper s safe no-op pro external (OFF) URLs.
- **Sprint 3B — Picker v add-items.tsx**: stejný pattern jako ItemEditSheet, ale wrapuje existující image/placeholder v Pressable. Empty state má "Tap to add photo" hint + category ikonu. `handleAddToQueue` blokuje Save během uploadu.
- **Sprint 3C — Claude Vision**: kompletní architektural pivot od původního plánu (Supabase Edge Function → direct client call s per-user key). Důvody a implementace viz Sprint 3 plan section výše. Path A (auto na OFF 404) + Path B (manual "✨ Identify with AI" button) + shelf life hint (ne prefill) + custom_products caching.
- **Sprint 3D — Brother print prototype**: hardware-independent Phase 1. `qrLabel.ts` generuje 80×24mm PDF přes `printToFileAsync` → `printAsync(uri)` two-step (direct HTML path iOS ignoroval a defaultil na A4). Dynamic font sizing podle `computeNameFontSize` heuristiky (54mm / chars × 0.62 char-ratio, floor 2mm, max 10mm) s center align. QR obsahuje zaoblené logo bedny v 7.5mm tile — asset `label-logo.png` (nano banana 3D crate) prošel Python PIL pipeline (auto-crop bbox detection, Gemini watermark removal z bottom-right, background clean-up threshold ≥230 → pure white, 8px rounded rect border 38px radius baked-in). Error correction H pro scanner reliability. `printBoxLabel` + `shareBoxLabelPdf` helpery napojené v `LabelModalContent` + post-create QR preview. In-app QR views (`react-native-qrcode-svg`) používají stejný asset pro visual consistency.

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

**Otevřené drobnosti** (non-blocking):
- Orphan cleanup v storage (cancelled drafts s uploadedem foto). Defer.
- `visionEnabled` se čte jen na mount v add-items — pokud user nastaví klíč mid-session na Profile a hned skočí scan, refresh neproběhne (screen je v různé stack entry). Acceptable; fix přidat `useFocusEffect`.
- Brother tisk Phase 2 — až dorazí hardware, reálný print test + ladění CSS/layout podle skutečného výstupu.

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
