# Technologická rozhodnutí – Kalta

Tento dokument zachycuje **proč** jsme si vybrali konkrétní technologie a patterny. Slouží jako reference pro budoucí rozhodování — pokud někdo navrhne „přepsat X na Y", tady najde, jaká byla původní úvaha.

---

## 1. Expo 51 vs. bare React Native

**Zvoleno: Expo 51** (managed workflow s prebuild)

### Proč Expo
- Single dev — setup bare RN projektu včetně iOS/Android build pipeline je overhead, který pro 2-usera appku nestojí za to
- `expo-apple-authentication`, `expo-camera`, `expo-haptics`, `expo-clipboard`, `expo-notifications` jsou maintained oficiálně a verze zaručují vzájemnou kompatibilitu
- EAS Build umožňuje cloud build → TestFlight jedním příkazem (`eas build --profile preview && eas submit`)
- Expo Router file-based nav je jednodušší než ruční React Navigation setup

### Co by muselo přijít, abychom přešli na bare
- Potřeba native modulu bez Expo config pluginu (Niimbot BLE nepotřebuje — `react-native-ble-plx` má Expo config plugin)
- Performance problém, který vyžaduje custom C++ modul
- Ani jedno v dohledu

### Expo prebuild vs. managed-only
Jedeme **prebuild** (`npx expo prebuild --platform ios` generuje `ios/` složku). Důvod: Apple Sign In, BLE, a další native moduly potřebují custom permissions/entitlements, které managed-only runtime (Expo Go) nepodporuje. Prebuild drží všechny výhody Expo (config pluginy, EAS, versioning) a přitom dovoluje jakékoli native moduly.

---

## 2. Supabase vs. Firebase / custom backend

**Zvoleno: Supabase**

### Proč Supabase
- **Postgres** — schema-first, relace, triggery, CHECK constraints. Firebase Firestore je schemaless a při složitějších vztazích (warehouse → boxes → items) by to bylo peklo
- **RLS policies** — multi-tenant izolace vyřešená na úrovni DB. Jeden `is_member(wh)` predikát a všechny queries jsou automaticky bezpečné. Firebase by vyžadoval custom security rules, které jsou DSL a hůř se testují
- **Realtime** — WebSocket channels na postgres_changes. Firebase má lepší offline-first, ale realtime je v obou stejně dobrý
- **Free tier** stačí pro 2-user appku napořád (500MB DB, 1GB storage, 50k MAU)
- **Auth s native Apple ID token** bez webview (alternativa u Firebase je Firebase Auth, taky podporuje)
- **Storage** pro obrázky produktů — built-in, public bucket, RLS podporované

### Alternativy zvážené
- **Firebase** — Firestore schemaless by trápil při relacích, security rules jsou DSL. Ne.
- **Custom backend (Node/Go + Postgres)** — overkill. Infrastruktura, deployment, secrets, monitoring — žádná hodnota navíc oproti Supabase pro 2-user appku.
- **AWS Amplify** — komplexita 10x vyšší než Supabase, žádný přínos.
- **PocketBase self-hosted** — musel bych provozovat VPS. Supabase managed vyhrává.

### Supabase patterns, které používáme
- **RLS helper funkce** `is_member(wh)` a `is_owner(wh)` v `schema.sql`. Nepoužíváme inline subselecty v policies, protože by způsobovaly recursive RLS checks při self-referencích (např. warehouse_members → warehouses → is_member kontrola → warehouse_members → ...)
- **Auto-create `public.users`** po registraci přes trigger `handle_new_user` na `auth.users`. Uživatel se tak vždy vytvoří v jedné transakci s auth záznamem.
- **Box cache triggery** — `boxes.nearest_expiry` a `boxes.item_count` jsou cache sloupce, přepočítávané triggerem `recalc_box_cache` po každé změně v `items`. Alternativa (vypočítat v query přes JOIN) by šla, ale cache je rychlejší pro dashboard list a triggery nám to drží konzistentní.

---

## 3. Expo Router vs. React Navigation

**Zvoleno: Expo Router 3.5** (file-based, postaveno nad React Navigation)

### Proč
- File-based routing = méně boilerplate (`app/box/[id].tsx` = dynamická route)
- Deep linking free — `kalta://invite/TOKEN` automaticky mapuje na `app/invite/[token].tsx`
- Typed routes (experimental flag zapnut v `app.json`) — při `router.push` je path typovaný
- Pod kapotou pořád React Navigation, takže plný ekosystém funguje (Stack, Tabs, Modal)

### Struktura route groups
- `(auth)` group pro login (bez tabbaru, bez back gestu)
- `(app)` group pro autorizovaný obsah
- Auth guard v `app/_layout.tsx` přepíná podle session

---

## 4. Auth: Apple Sign In native ID token flow

**Zvoleno: native ID token flow přes `expo-apple-authentication` + `supabase.auth.signInWithIdToken`**

### Proč native flow místo web OAuth
- **Nativní UI** — systémové Face ID / Touch ID dialog
- **Nepotřebuje web view** — žádný redirect loop přes Safari
- **Nepotřebuje Apple Service ID + private key** — stačí bundle ID (client ID) v Supabase konfiguraci
- **Bezpečnější** — identity token je krátký JWT podepsaný Apple, Supabase ho ověří proti Apple public klíčům

### Flow
```
1. Apple vrací credential s identityToken (JWT) + raw nonce
2. Nonce hashujeme SHA256, posíláme Apple jako hashed
3. Raw nonce posíláme Supabase jako součást signInWithIdToken
4. Supabase ověří Apple signature + nonce match
5. Session uložena v AsyncStorage přes supabase-js
```

### Pozor
- **Apple Sign In vyžaduje placený Developer Program** ($99/rok) kvůli capability registraci na bundle ID
- V Expo Go nefunguje — `expo-apple-authentication` je nativní modul
- Na Androidu taky ne — náš projekt je iOS-only

### Alternativa pro budoucnost (bez Developer účtu)
- **Magic link** přes Supabase email OTP — `supabase.auth.signInWithOtp({ email })` → email s linkem → deep link do appky → session
- **Passkeys** — WebAuthn nativně, ale komplexnější setup
- Rozhodnutí: **nepřidávat jako paralelní flow**, buď Apple nebo magic link. User si platí Developera, takže jedeme Apple.

---

## 5. Kamera a barcode scanning

**Zvoleno: `expo-camera` CameraView** (SDK 51+)

### Proč ne legacy BarCodeScanner
- Expo SDK 51 deprekoval `expo-barcode-scanner` — veškerá funkcionalita sjednocena do `expo-camera`
- Nový `CameraView` umí scanning přes `onBarcodeScanned` prop bez samostatného komponentu
- Podporuje více formátů najednou přes `barcodeScannerSettings.barcodeTypes`
- `enableTorch` prop pro svítilnu (netřeba separate modul)

### Formáty, které skenujeme
```ts
['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr']
```
- `ean13/ean8` — EU potraviny
- `upc_a/upc_e` — americké produkty
- `code128/code39` — farmaceutické a industriální kódy
- `qr` — naše vlastní bedny + fallback pro produkty s QR (některé BIO potraviny)

### Debounce
`CameraView.onBarcodeScanned` volá callback na každý rozpoznaný frame. Debounce přes `useRef<string | null>` — ignorujeme opakovaný kód, dokud se neresetuje při návratu na scan mód.

---

## 6. QR kód generation: `react-native-qrcode-svg`

**Zvoleno** místo `react-qr-code` / `qrcode-svg`

### Proč
- Render jako SVG přes `react-native-svg` (už máme v projektu)
- Umí backgroundColor, logo, error correction levels
- Pro Sprint 3 (tisk): SVG lze přes `react-native-view-shot` převést na PNG pro Niimbot
- Maintained, stabilní API

### QR value
V `boxes.qr_code` ukládáme random UUID string (trigger default `gen_random_uuid()::text`). QR obsahuje ten string, scanner ho čte a volá `getBoxByQr(qr)` — unique index v DB zajistí rychlý lookup.

**Proč ne `boxes.id`:** ID je UUID, které se leakuje — kdokoli s přístupem k QR by znal interní PK. Samostatné `qr_code` pole dovoluje v budoucnu QR rotovat (když se ukradne štítek) bez změny ID.

---

## 7. Date picker: `@react-native-community/datetimepicker`

**Zvoleno** místo JS-only (např. `react-native-date-picker`)

### Proč
- Používá **native iOS UIDatePicker** v inline módu (iOS 14+) — vypadá identicky jako v Apple Reminders/Calendar
- `locale="cs-CZ"` → český kalendář (pondělí první)
- Integrovaný přímo do React Native core by jeho maintaineři (community-maintained)
- Malý bundle size (žádné JS date logic navíc)

### Pozor na iOS inline mód
`display="inline"` je v iOS 14+. Pro starší iOS (kterých máme 0%) by bylo potřeba `"spinner"`. Default je OK.

---

## 8. Produktová DB: Open Food Facts

**Zvoleno** místo placených (Nielsen, GS1) nebo vlastní scrape

### Proč
- **Zdarma**, community-driven, ~3M produktů, REST API bez klíče
- **EU pokrytí ~85%** pro potraviny, léky, drogerie — tj. naše cílové kategorie
- JSON response, snadný parsing
- Vrátí název, obrázek, brand, categories tags (které mapujeme na naše domain kategorie)

### Waterfall lookup
Když user naskenuje EAN, jdeme v pořadí:
1. **`custom_products`** v naší DB (zapamatované produkty z předchozích skenů)
2. **Open Food Facts** (externí API)
3. **Manual fallback** (prázdný form s hintem „Produkt není v databázi")

Custom products je optimalizace — user, který už jednou naskenoval Ibuprofen a vyplnil název, se příště nebude ptát OFF znovu. Zároveň funguje offline (jednou zapamatované produkty jsou lokální v Supabase).

### Mapování kategorií
OFF vrací `categories_tags` jako pole stringů (`"en:dairy"`, `"en:medicine"`, atd.). V `src/lib/openFoodFacts.ts` máme heuristický regex matcher, který mapuje na naše 8 domain kategorií (potraviny, léky, voda, dezinfekce, …). Nedokonalé, ale pro 2-user appku OK — user si vždy může kategorii přepsat.

### Alternativy
- **Barcoder** (placený, USA) — moc drahý
- **UPC Database** (placený, USA) — USA centric, málo EU pokrytí
- **GS1 GEPIR** (oficiální, placený) — B2B, ne pro klienty
- **Scrapovat Albert/Tesco** — právní šedá zóna, nestabilní
- **Claude Vision na fotku EAN** — drahé, pomalé, overkill

---

## 9. State management

**Zvoleno: žádný** — local `useState` + realtime subscriptions

### Proč ne Redux/Zustand/Jotai
- Appka má **2 hlavní screeny** (Dashboard, Box detail) + naskladňovací session
- Žádný **shared state** mezi nesousedícími screeny — každý screen si načte data samo z Supabase
- **Realtime subscriptions** dělají sync automatically — žádný důvod udržovat local store
- Zavedení state library by byla komplexita bez hodnoty

### Co je v AsyncStorage
- Supabase session (spravuje supabase-js sám)
- `kalta:boxViewMode` — preference mřížka/seznam v detailu bedny (viz `box/[id].tsx`)

### Co **NENÍ** persistované
- Draft v naskladňovací session — když user zavře appku uprostřed skenování, fronta se ztratí. Úmyslně. Přidat persistenci by vyžadovalo řešit invalidaci (co když se v mezičase změnilo custom_products) a user benefit je nízký.

---

## 10. Modal patterns: sheet komponenty

**Zvoleno: React Native `Modal` s `presentationStyle="pageSheet"`**

### Kde
- `ItemEditSheet` (v `src/components/`)
- `BoxEditSheet` (v `src/components/`)
- Label modal v `box/[id].tsx` (inline)

### Proč pageSheet místo fullScreen
- **iOS native gestures**: swipe-down zavírá modal
- **Vizuálně oddělený kontext** — user ví, že je ve „dočasném" view
- **Background je viditelný** v horní části (modal nejde úplně nahoru), takže user neztrácí orientaci

### Proč modaly, ne samostatné screeny (`box/[id]/edit.tsx`)
- **Méně routingu**, méně souborů
- **State se nepřetěžuje navigací** — po uložení stačí `onSaved` callback + `setEditingItem(null)`, žádný `router.back()` ani `router.push`
- **Konzistentní s iOS konvencí** — edit je v Apple apps typicky modal (Contacts, Reminders, Notes)

### Výjimka: `box/new.tsx` je screen, ne modal
Protože po vytvoření potřebujeme plnou plochu pro QR náhled + redirectovat na detail. V modalu by to byl overhead.

---

## 11. Action sheets: `ActionSheetIOS`

**Zvoleno** místo custom dropdown / bottom sheet libs

### Proč
- **Systémová komponenta** — vypadá stejně jako v Apple Mail/Photos/Safari
- **Žádná dep**, automatický dark mode, automatická lokalizace, haptic feedback
- `destructiveButtonIndex` pro červené "Smazat"
- Jediné omezení: iOS only — ale projekt je iOS only

### Kde
- `box/[id].tsx` header right "⋯" → Štítek / Upravit / Smazat

### Kdyby byl Android
`@expo/react-native-action-sheet` má cross-platform wrapper. Zatím není potřeba.

---

## 12. Haptic feedback: `expo-haptics`

**Zvoleno** pro UX polish

### Patterns
- **Success notification** (`Haptics.notificationAsync(Success)`): po úspěšném přidání do fronty, po kopírování QR
- **Warning notification**: když OFF nenašel produkt (signál „musíš něco udělat")
- **Selection** (`Haptics.selectionAsync()`): při custom/OFF hitu, při toggle svítilny
- Všude `.catch(() => {})` — starší iPhone bez Taptic Engine neshodí flow

### Proč ne `Vibration` (RN core)
`Vibration` je binární (on/off), žádné vzory. `expo-haptics` používá Taptic Engine patterns (UINotificationFeedbackGenerator), které uživatel rozezná i bez audio.

---

## 13. Gesture handling: `react-native-gesture-handler` + `Swipeable`

**Zvoleno** pro swipe-to-delete v list módu detailu bedny

### Proč ne RN built-in
- RN nemá nativní Swipeable komponent
- `react-native-gesture-handler` je **standard** v ekosystému a už byl v projektu (Expo default)
- `Swipeable` je high-level wrapper, render right/left actions, auto-close při scrollu

### GestureHandlerRootView
Musí obalovat celou app tree, jinak `Swipeable` tiše nefunguje. Přidáno v `app/_layout.tsx`.

### Swipe vs. grid
`Swipeable` na 3-sloupcové mřížce nefunguje dobře (úzké karty, swipe by kolidoval s vertikálním scrollem). Proto je swipe-to-delete **jen v list módu**. V grid módu user maže přes edit sheet (tap → modal → „Smazat položku").

---

## 14. Niimbot B21 tisk (Sprint 3, zatím neimplementováno)

**Plán: `react-native-ble-plx` + custom protocol handler**

### Proč custom protocol
Niimbot nemá oficiální SDK. Protokol byl reverzován komunitou — existují Python implementace (`niimprint`) a JS port (`niimbluelib`). Pro iOS existuje open-source `NiimPrintX` v Swift.

### Plán
1. `react-native-ble-plx` — BLE scan, connect, write characteristic
2. Port `niimbluelib` JS protocol handlera do `src/lib/niimbot.ts`
3. QR SVG → PNG bitmap přes `react-native-view-shot`
4. Bitmap → 1-bit raster → Niimbot packet stream
5. Write po chunks do characteristic `0000ff02-0000-1000-8000-00805f9b34fb`

### Fallback bez tiskárny
- **`expo-sharing`** — share QR image přes iOS share sheet (user může poslat na AirPrint tiskárnu, AirDrop, iMessage, …)
- **`expo-print`** — přímý AirPrint dialog

---

## 15. Claude Vision (Sprint 3, zatím neimplementováno)

**Plán: Supabase Edge Function s `ANTHROPIC_API_KEY` v env**

### Proč přes Edge Function, ne přímo z klienta
- **API key nesmí být v klientu** — React Native bundle jde dekomplilovat, každý uživatel by našel tvůj API key
- Edge Function drží klíč v Supabase Secrets, klient volá autentizovaný endpoint
- Dává možnost do budoucna přidat rate limiting per user

### Flow
1. User vyfotí produkt v add-items session (pokud OFF 404 a nechce vyplnit ručně)
2. Foto base64 → POST na `/functions/v1/identify-product`
3. Edge function volá Anthropic API s instrukcí „identify this product, return JSON"
4. Odpověď zpátky → prefill draft formuláře
5. Foto uploadnuté do Supabase Storage → URL do `items.image_url`

### Náklady
- Claude Sonnet 4.5 Vision ~$3 / MTok input, $15 / MTok output
- Fotka produktu ~ 1500 tokens input, 200 tokens output = **~$0.0075 za sken**
- Pro 2-user appku se scan objemem ~50/měsíc: **$0.40/měsíc**. Vendor lock-in minimální.

---

## 16. Push notifikace (Sprint 4, zatím neimplementováno)

**Plán: `expo-notifications` lokálně + Supabase Edge Function cron globally**

### Dvě vrstvy
1. **Lokální** scheduled notifications — při spuštění appky se přečtou všechny items a naplánují notifications na `expiry_date - 30 days / - 7 days / same day`. Funguje i offline.
2. **Server-side** — Edge Function s cron triggerem denně checkne, pro které items expiry_date přibližuje, pošle push přes Expo Push API nebo APNs přímo.

### Proč ne jen lokální
Když user appku neotevře 2 měsíce, lokální scheduled notifications zůstanou podle stavu z posledního otevření — nové položky přidané manželkou se nepřeplánují. Server-side cron to pokryje.

### Proč ne jen server-side
Server push vyžaduje Expo Push Token (nebo APNs device token), který se musí registrovat. Lokální je rychlejší a funguje i bez serveru.

---

## 17. Sprint 2 – konkrétní rozhodnutí

### List vs. Grid toggle (D)
- **Jen 2 módy** (ne "malá/velká mřížka" jako Photos). Více módů = více práce + málo hodnoty.
- **Perzistence** v AsyncStorage pod klíčem `kalta:boxViewMode` — **globálně**, ne per-box. User, kterému se líbí grid, chce grid všude.
- **FlatList re-mount trick**: `key={viewMode}` kvůli changed `numColumns` (RN crashne bez toho).

### Swipe-to-delete jen v list (A2)
- V gridu místo swipe: **tap → edit modal → Smazat tlačítko dole** (konzistentní delete cesta)

### Source banner v add-items (J)
- 3 varianty: custom (zelený), OFF (modrý), manual (oranžový)
- Na první pohled user pozná, jestli se má spoléhat na prefill

### Toast + haptic po přidání (H)
- Toast přes `Animated.sequence` — fade in/out atomicky, nová položka restartuje cyklus
- Haptic `.catch(() => {})` — nikdy neshodí UI na starších zařízeních

### Error states s retry (G)
- **Chyba neshodí UI, pokud jsou cached data** — silent catch do state
- Full error screen jen když `!box && error` (detail) nebo `!boxes.length && error` (dashboard)

---

## Alternativy, které jsme NEZAVRHLI, ale zvážili

- **NativeWind (Tailwind pro RN)** — zvážím jestli neustanu v čistých `StyleSheet.create`. Pro teď: drž se StyleSheet, je to konzistentní s celým kodbasem. Kdyby začal boletť duplicit CSS, přepneme.
- **Zustand / Jotai** — pokud appka vyroste (offline sync, shared filters), možná. Teď nepotřebujeme.
- **React Hook Form** — formuláře jsou krátké (2-5 polí), ruční `useState` je jednodušší. Při 10+ polích to zvážit.
