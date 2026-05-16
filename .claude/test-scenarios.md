# Testovací scénáře – Kalta

Manuální testy, které projít po každé větší změně. Cílem není TDD/unit testy (projekt zatím žádné nemá), ale ověření key flows — co funguje, co ne, co vizuálně blbne.

**Značení:**
- 🟢 Happy path
- 🟡 Edge case
- 🔴 Error / failure path

---

## 0. Setup / předpoklady

Před testováním:
- [ ] `npm install` proběhl bez errors (warnings jsou OK)
- [ ] `.env` vyplněný
- [ ] Supabase schema spuštěné
- [ ] `npx expo run:ios` — native build proběhl
- [ ] Apple Developer Program aktivní (pro Apple Sign In)
- [ ] V Supabase Auth → Providers → Apple zapnuto

---

## 1. Login flow

### 🟢 1.1 První přihlášení (nový user)
1. Otevřít appku → zobrazí se Login screen s logem 📦, názvem "Kalta", Apple Sign In tlačítkem
2. Tap na Apple button → systémový dialog
3. Schválit Face ID / heslo
4. Appka se přepne na Dashboard — prázdný state "Zatím žádné bedny" s CTA "+ Vytvořit první bednu"
5. V Supabase `auth.users` + `public.users` + `public.warehouses` + `public.warehouse_members` (role=owner) se vytvoří záznamy

**Co ověřit:**
- [ ] Display name se uloží z Apple credential (jen při prvním přihlášení)
- [ ] Warehouse s názvem "Domácí sklad" existuje
- [ ] Member row má `role='owner'`

### 🟢 1.2 Opětovné přihlášení (už existující user)
1. Odhlásit (dočasné tlačítko "Odhlásit" na dashboardu)
2. Login screen se zobrazí
3. Apple Sign In → session se obnoví, přechod na Dashboard
4. Data předchozího skladu jsou stále vidět

### 🔴 1.3 Uživatel zruší Apple prompt
1. Na login tapnout Apple button
2. V systémovém dialogu zavřít / Cancel
3. Nevyvolat error alert — `ERR_REQUEST_CANCELED` se tiše ignoruje
4. Uživatel může tapnout znovu

### 🔴 1.4 Chybí Developer Program
- Pokud není Apple Developer aktivní, Apple Sign In se nepodepíše — dostane se k `signInWithIdToken`, ale Supabase odmítne
- Expected: user uvidí error alert "Chyba přihlášení"

---

## 2. Dashboard

### 🟢 2.1 Prázdný stav (nový user)
1. Login → Dashboard
2. Empty state:
   - Emoji 📦
   - "Zatím žádné bedny"
   - "Vytvoř první bednu a přilep si na ni QR štítek."
   - Tlačítko "+ Vytvořit první bednu"
3. Tap CTA → naviguje na `box/new`

### 🟢 2.2 Seznam beden
1. Vytvořit 3+ bedny s různými daty expirace (přes naskladnění)
2. Dashboard zobrazí bedny **seřazené**: expired → critical → soon → ok
3. Každá karta ukazuje:
   - Název (bold)
   - Lokace s 📍 (pokud je)
   - Počet položek (1 položka / 2 položky / 5 položek — správné deklinace)
   - Expiry badge s čitelným textem ("Expiruje za 5 dní" / "Prošlo včera" …)
4. Bedny s kritickou/expired expirací mají červené pozadí badge

### 🟢 2.3 Kritický banner
1. Mít aspoň 1 bednu s expired/critical expirací
2. Nad listem se zobrazí červený banner "⚠️ X beden má kritickou expiraci"
3. Při smazání / prodloužení expirace banner zmizí

### 🟢 2.4 Pull-to-refresh
1. Swipe down na dashboardu
2. ActivityIndicator se zobrazí
3. Data se refetchnou (změny provedené na druhém zařízení se propíšou)

### 🟢 2.5 Realtime sync
1. Otevřít appku na 2 zařízeních / 2 instancích (emulátor + real)
2. Na device A vytvořit novou bednu
3. Na device B se do 1s objeví nová bedna v listu (bez pull-to-refresh)

### 🔴 2.6 No network na loadu
1. Vypnout Wi-Fi před spuštěním appky
2. Login (pokud session cache funguje) → Dashboard → loading → po timeoutu error screen
3. Zobrazí se ⚠️ + "Něco se pokazilo" + popis chyby + "Zkusit znovu"
4. Zapnout Wi-Fi → tap "Zkusit znovu" → načte se normálně

### 🔴 2.7 Network fail při pull-to-refresh (s existujícími daty)
1. Načíst dashboard (s daty)
2. Vypnout Wi-Fi
3. Pull-to-refresh → spinner zmizí, **ale data zůstávají viditelná** (silent catch)
4. Neshodí UI do error screenu
5. Příští pull s network → refresh se podaří

### 🟡 2.8 FAB akce
1. Na dashboardu tlačítko "📷 Skenovat QR" → naviguje na `scan`
2. Tlačítko "+ Nová bedna" → naviguje na `box/new`

---

## 3. Vytvoření bedny

### 🟢 3.1 Happy path
1. Dashboard → "+ Nová bedna"
2. Formulář: zadat název "Léky A"
3. Vyplnit lokaci "Police 2" (volitelné)
4. "Vytvořit bednu"
5. Přepne se na QR náhled:
   - Velký QR kód
   - Název "Léky A"
   - Lokace "📍 Police 2"
   - Raw UUID pod kódem
   - Disabled tlačítko "🖨 Tisknout (Sprint 3)"
   - "Přejít na detail" + "Zpět na dashboard"
6. "Přejít na detail" → box detail s 0 položkami, empty state "📥 Bedna je prázdná"

### 🔴 3.2 Prázdný název
1. Formulář: nechat název prázdný
2. Tapnout "Vytvořit bednu"
3. Alert "Chybí název" se zobrazí
4. Kurzor zůstane v poli

### 🔴 3.3 No network
1. Vypnout Wi-Fi
2. Zadat název → "Vytvořit bednu"
3. Alert "Chyba" s network error
4. Formulář zůstane vyplněný, user může zkusit znovu

---

## 4. Detail bedny

### 🟢 4.1 List mód (default)
1. Otevřít bednu s položkami
2. Header zobrazí:
   - Název bedny v nav titleru
   - "⋯" v pravém horním rohu
   - Lokace (pokud je)
   - Count + expiry badge
   - Segmented control: ☰ Seznam / ▦ Mřížka
3. Položky jsou v list řádcích:
   - Thumbnail 52×52 (obrázek nebo category emoji)
   - Název
   - Množství + jednotka
   - Expiry badge vpravo

### 🟢 4.2 Toggle na Grid
1. Tap "▦ Mřížka" v segmented
2. List se přepne na 3-sloupcovou mřížku
3. Každá karta: velký obrázek, název (2 řádky max), množství, mini badge s "MM/RR"
4. AsyncStorage uloží preferenci — next time otevření bedny → rovnou grid
5. Toggle zpět na Seznam

### 🟢 4.3 Swipe-to-delete (jen list mód)
1. V list módu swipnout řádek zprava doleva
2. Odhalí se červené tlačítko "Smazat" (88px)
3. Tap "Smazat" → confirmation "Opravdu smazat „{name}"?" → Smazat
4. Item zmizí z listu (optimistic update)
5. Realtime sub potvrdí

### 🟢 4.4 Auto-close předchozího swipu
1. Swipnout řádek A → viditelné Smazat
2. Swipnout řádek B → řádek A se automaticky zavře, B zůstává otevřený

### 🟢 4.5 Tap na řádek → edit modal
1. Tap na řádek (ne swipe)
2. Zdola vyjede ItemEditSheet s pre-filled hodnotami
3. Změnit množství z 2 na 3 → "Uložit"
4. Sheet se zavře, položka v listu má nové množství
5. Realtime sub nakonec potvrdí

### 🟢 4.6 Edit modal — změna data expirace
1. Tap řádek → edit sheet
2. Tap "Vyber datum" / aktuální datum → inline kalendář se otevře pod polem
3. Vybrat nové datum → datum v poli se aktualizuje (formát "15. 3. 2027")
4. "Uložit" → item má nové datum, expiry badge se přebarví podle nového status
5. Na dashboardu se bedna přeřadí podle nového nearest_expiry

### 🟢 4.7 Edit modal — smazat datum
1. Tap řádek s datem → edit sheet
2. Vedle data tlačítko "Smazat" (červené)
3. Tap → datum zmizí, zobrazí se "Bez data"
4. "Uložit" → item už nemá expiry badge

### 🟢 4.8 Edit modal — smazat položku
1. Tap řádek → edit sheet
2. Dole "Smazat položku" (červené pozadí)
3. Tap → confirmation → smazat
4. Sheet se zavře, item zmizí z listu

### 🟢 4.9 Tap na prázdný řádek v grid módu
1. Přepnout na Mřížku
2. Tap kartu → edit sheet se otevře
3. Save → kartička má novou hodnotu
4. V grid módu není swipe — mazání jen přes edit sheet

### 🟢 4.10 Action sheet menu (⋯)
1. Tap "⋯" v header baru
2. Vyjede systémový action sheet:
   - 🏷 Zobrazit QR štítek
   - ✏️ Upravit bednu
   - 🗑 Smazat bednu (červené)
   - Zrušit
3. Tap "Zobrazit QR štítek" → modal s QR

### 🟢 4.11 Edit bedny
1. Action sheet → "Upravit bednu"
2. BoxEditSheet modal s pre-filled jménem a lokací
3. Změnit "Léky A" → "Léky (lednička)"
4. "Uložit" → header title se okamžitě změní
5. Dashboard (při návratu) má nový název

### 🟢 4.12 Smazat bednu
1. Action sheet → "Smazat bednu"
2. Confirmation alert s varováním o smazání položek
3. Smazat → redirect na dashboard
4. Bedna zmizí z listu
5. Všechny items smazané (CASCADE v DB)

### 🟢 4.13 QR štítek modal
1. Action sheet → "Zobrazit QR štítek"
2. PageSheet se otevře — QR kód, název, lokace, UUID pod kódem
3. Tap na UUID → text se změní na "✓ Zkopírováno" (zelené), haptic feedback
4. Po 1.5s zpět na "📋 Kopírovat" (modré)
5. Přepnout do Notes app → paste → UUID tam je
6. Swipe down nebo "Zavřít" → sheet se zavře

### 🔴 4.14 Bedna neexistuje
1. Ručně v DB smazat bednu (simulate deleted by jiný user)
2. Tapnout na bednu v dashboardu (která už tam není z cache)
3. Error: "Bedna nenalezena" / error screen
4. Tlačítko "Zpět na dashboard"

### 🔴 4.15 Load error bedny
1. Otevřít detail bedny
2. Vypnout Wi-Fi
3. Pull-to-refresh → silent catch, data zůstanou
4. Zavřít appku, vypnout Wi-Fi, otevřít znovu → detail selže → error screen s "Zkusit znovu" + "Zpět na dashboard"

---

## 5. Naskladňovací session (add-items)

### 🟢 5.1 Scan EAN s OFF hit
1. Detail bedny → "+ Naskladnit"
2. Camera view s rámečkem, svítilna vpravo nahoře, "Přidat ručně" dole
3. Namířit na EAN běžné potraviny (např. mléko, pivo)
4. Rozpoznán → haptic selection → form mód
5. **Modrý source banner** "✓ Načteno z Open Food Facts — zkontroluj a doplň datum"
6. Prefilled: název, obrázek produktu, kategorie (heuristika)
7. Zadat množství (1), jednotku (ks), **datum expirace přes inline kalendář**
8. "+ Přidat do fronty" → haptic success + zelený toast "✓ Přidáno: {name}" (1.5s fade)
9. Zpět na scan mode, draft vyčištěný, fronta níže zobrazuje přidanou položku

### 🟢 5.2 Scan EAN s custom product hit
1. Přidat stejný EAN podruhé (po bodě 5.1)
2. Scanner ho najde v `custom_products` (zapamatované z předchozího)
3. **Zelený source banner** "✓ Dříve přidaný produkt — doplň množství a datum"
4. Prefill z custom DB (rychlejší než OFF)
5. Stejný flow jako 5.1

### 🟢 5.3 EAN 404 → manual fallback
1. Naskenovat obskurní/neznámý EAN (např. vlastní vytištěný QR s náhodným číslem nebo lokální kód bez OFF záznamu)
2. Haptic warning (odlišný od success)
3. Form otevřen s prázdnými poli
4. **Oranžový source banner** "⚠️ Produkt {barcode} není v databázi — vyplň ručně"
5. User vyplní název ručně, doplní datum
6. "+ Přidat do fronty" — uloží do custom_products pro příště

### 🟢 5.4 "Přidat ručně" bez skenování
1. Na scan screenu tap "Přidat ručně"
2. Form s prázdnými poli + oranžový banner "Ruční zadání"
3. Vyplnit vše, "+ Přidat do fronty"

### 🟢 5.5 "Stejné, jiné datum"
1. Mít aspoň 1 item ve frontě (z předchozího skenu)
2. Tap na "↻ Jiné datum" na chip karty ve frontě
3. Otevře se form předvyplněný **vším kromě data expirace**
4. Nové datum → "+ Přidat do fronty"
5. Ve frontě jsou teď 2 chipy stejného produktu s různými daty

### 🟢 5.6 Batch save
1. Přidat 3+ položky do fronty
2. Tap "Uložit vše" (v horním pravém rohu fronty)
3. Full-screen overlay s "Ukládám X položek…"
4. Po úspěchu redirect na detail bedny
5. Všechny 3 položky tam jsou, realtime sub potvrdí

### 🟢 5.7 Svítilna
1. V scan módu tap 💡 (top-right v camera overlay)
2. Rozsvítí se LED (fyzické zařízení)
3. Ikona změní na 🔦
4. Haptic selection
5. Tap znovu → vypne

### 🟢 5.8 Smazat z fronty
1. Mít 2+ položky ve frontě
2. Tap × v rohu chipu
3. Chip zmizí, fronta se zmenší

### 🔴 5.9 Prázdný název při save
1. V form módu nechat název prázdný
2. Tap "+ Přidat do fronty"
3. Alert "Chybí název"

### 🔴 5.10 Chybí datum
1. Vyplnit vše kromě data
2. "+ Přidat do fronty"
3. Alert "Chybí datum expirace"

### 🔴 5.11 Nulové množství
1. Nastavit quantity na 0 nebo prázdné
2. "+ Přidat do fronty"
3. Alert "Chybí množství"

### 🔴 5.12 Permission denied pro kameru
1. V iOS Settings → Kalta → Camera → vypnout
2. Otevřít add-items
3. Zobrazí se permission screen "Potřebuju kameru" + "Povolit kameru" + "Přidat ručně"
4. Manual flow pořád funguje

### 🔴 5.13 OFF API down
1. (simulovat: vypnout Wi-Fi po otevření scan módu)
2. Naskenovat EAN
3. Alert "Nelze se připojit k Open Food Facts"
4. Zpět na scan, možnost manual

---

## 6. Scan QR (`scan.tsx`)

### 🟢 6.1 Scan known QR
1. Dashboard → "📷 Skenovat QR"
2. Camera view fullscreen s bílým frame
3. Namířit na QR kód existující bedny (může být printscreen z `box/new` nebo label modal)
4. Rozpoznán → "Načítám bednu…"
5. Redirect na detail bedny

### 🔴 6.2 Unknown QR
1. Scanner rozpozná cizí QR (např. z jiné appky, webová URL)
2. Alert "Neznámý QR kód — tato bedna není v tvém skladu"
3. Tap OK → scanner pokračuje

### 🔴 6.3 Permission denied
1. V iOS Settings camera permission off
2. Scan screen ukáže "Potřebuju kameru" + tlačítko povolit

### 🔴 6.4 Zrušit
1. Scan screen má dole "Zrušit" tlačítko
2. Tap → `router.back()` zpátky na dashboard

---

## 7. Expiry status logic (unit-like)

Tyhle by měly být ideálně unit testy, zatím manuálně:

### 🟡 7.1 Různé data
Vytvořit položky s daty:
- Včerejšek → `expired`, badge "Prošlo včera" (červené `#F7C1C1`)
- Dnes → `critical`, "Expiruje dnes" (`#FCEBEB`)
- +5 dní → `critical`, "Expiruje za 5 dní"
- +45 dní → `soon`, "Expiruje za 1 měs." (`#FAEEDA`)
- +200 dní → `ok`, "Expiruje za 7 měs." (`#EAF3DE`)
- +2 roky → `ok`, "Expiruje za 2 r."

### 🟡 7.2 Řazení beden
1. 5 beden s různými `nearest_expiry` (dosaženo přes nejbližší položku)
2. Dashboard je seřadí od nejhoršího (expired) po ok
3. Bedna bez položek (`nearest_expiry = null`) je **na konci** (status `none`)

---

## 8. Deep linking

### 🟢 8.1 `kalta://invite/TOKEN`
1. Vytvořit invitation v DB ručně (přes `createInvitation`)
2. V Safari zadat `kalta://invite/{token}`
3. iOS se zeptá, jestli otevřít ve Kalta
4. Appka zpracuje token, pokud user přihlášen → `acceptInvitation`
5. Alert "Hotovo — pozvánka přijata"
6. Redirect na dashboard nového skladu

### 🔴 8.2 Expired invitation
1. Invitation s `expires_at` v minulosti
2. Deep link → Alert "Pozvánka vypršela"

### 🔴 8.3 Už přijatá invitation
1. Invitation s `accepted_at` != null
2. Deep link → Alert "Pozvánka už byla přijata"

### 🔴 8.4 User nepřihlášen
1. Odhlásit, zavřít appku
2. Deep link → Alert "Přihlaste se a otevřete odkaz znovu"

---

## 9. Multi-device / realtime

### 🟢 9.1 Simultánní přidání položky
1. Device A v detailu bedny
2. Device B naskladní položku do stejné bedny
3. Device A se do 1s aktualizuje (realtime sub na items)
4. Box header count se zvýší
5. Dashboard (pokud přepnu) ukáže nový expiry

### 🟢 9.2 Simultánní smazání bedny
1. Device A na dashboardu
2. Device B smaže bednu
3. Device A se bedna do 1s odstraní ze seznamu

---

## 10. Pre-commit checklist

Před každým `git commit` na nové feature:

- [ ] `npm run typecheck` projde bez errors
- [ ] Hot reload funguje (žádná nativní změna — pokud ano, rebuildnout)
- [ ] Aspoň 1 happy path z dotčeného flow projít manuálně
- [ ] Error state projít (vypnout Wi-Fi, nebo jiný fail case)
- [ ] Žádný `console.log` zapomenutý v kódu
- [ ] Žádný TODO/FIXME bez komentáře proč
- [ ] Česky všechny nové UI strings

---

## 11. Known issues / gotchas

### 11.1 FlatList numColumns change
Pokud přidáváš nový view mode (např. "velká grid") — musíš zajistit `key` re-mount (viz `box/[id].tsx` trick).

### 11.2 Haptics na simulátoru
Haptics nefungují v iOS simulátoru. Pro test haptics potřebuješ fyzické zařízení.

### 11.3 Camera v simulátoru
iOS Simulator má **fake camera** — scanner funguje, ale musíš v simulátoru nastavit "Device → Camera → Simulated Camera" na nějaký obrázek s čárovým kódem. Nebo otestovat na reálném zařízení.

### 11.4 Apple Sign In v simulátoru
Funguje, ale simulátor musí mít přihlášené Apple ID (Settings → Apple ID). Bez toho button otevře prázdný prompt a vrátí ERR_REQUEST_CANCELED.

### 11.5 Realtime subscription race
Optimistic update + realtime event občas blikne (200ms). Úmyslné, řešit jen pokud začne vadit.

### 11.6 Date picker locale
`locale="cs-CZ"` funguje jen když iOS má český lokál v Settings. Jinak fallback na en-US.

---

## 12. Subscription (Sprint 5)

**Preconditions:**
- `SUBSCRIPTION_ENFORCEMENT_ENABLED` v `src/lib/subscription.ts` flipnuté na `true` (pro real testing). Při `false` se kompletně přeskakují všechny gates a paywall není reachable přes auth guard.
- **Lokální testování (simulátor):** Xcode scheme má attach `storekit/Kalta.storekit` (Edit Scheme → Run → Options → StoreKit Configuration).
- **TestFlight testování:** Active Paid Apps Agreement + product `com.ondrejmichalcik.kalta.cloud_yearly` v ASC (Ready to Submit stačí) + Sandbox Apple ID přihlášený v iOS Settings → App Store → Sandbox Account.

### Časová zrychlení v sandboxu

| Real period | Sandbox time | StoreKit Config time |
|---|---|---|
| 1 týden | 3 min | nastavitelné v Xcode |
| 1 měsíc | 5 min | |
| 1 rok | 1 hodina | |

Sandbox subscription se auto-renewuje max 6× pak expire. Pro StoreKit Config v Xcode: Debug → StoreKit → Manage Transactions → můžeš ručně forcovat renew / expire / refund event.

### 🟢 12.1 Fresh install → mandatory paywall
1. Smaž app data (Settings → General → iPhone Storage → Kalta → Delete App + reinstall, nebo Erase Content v simulátoru).
2. Otevři app → Apple Sign In → po úspěšném loginu by se měl objevit `/paywall` (slide_from_bottom animace).
3. Paywall ukazuje: hero + 4 value props + "Subscribe — $14.99 / year" + auto-renew disclosure + Restore / Terms / Privacy linky.
4. Žádný X tlačítko k dismissu (mandatory).
5. Swipe-down nesmí dismissovat (zatím modal sheet — pokud to půjde, je to bug).

### 🟢 12.2 Subscribe flow
1. Z paywallu tap Subscribe.
2. iOS payment sheet (sandbox: zelená "Sandbox" hlavička).
3. Confirm → krátké loading → příští render: auth guard detekuje `status === 'active'` → router.replace na `/`.
4. App vstoupí normálně. Profile → SUBSCRIPTION sekce ukazuje "Active · Renews YYYY-MM-DD".

### 🟢 12.3 Restore flow (reinstall scenario)
1. Pre-cond: Apple ID už má historický nákup (testováno přes 12.2 dřív).
2. Smaž a reinstaluj app.
3. Login → paywall (status='loading' krátce, pak 'never' protože cache empty).
4. Tap **Restore** dole na paywallu.
5. StoreKit by měl vrátit historický transaction → status flipne na 'active' nebo 'lapsed' → auto-redirect do app.

### 🟡 12.4 Lapsed mode (sub expired)
1. V StoreKit Config (Xcode) → Manage Transactions → vyber active subscription → "Expire Subscription".
2. App refresh (background fetch nebo restart) → status='lapsed'.
3. Profile → SUBSCRIPTION ukazuje "Inactive — local-only mode" + Renew button.
4. SyncStatusBar nahoře v app: **warning banner** "Cloud sync off · Renew to resume".
5. Add item — funguje normálně.
6. Add item s photo — uploadProductImage hodí `CloudFeatureDisabledError`, item se vytvoří bez fotky.
7. Try AI vision — `CloudFeatureDisabledError`.
8. P2P sync — funguje.
9. EAN scan — funguje (OFF lookup).
10. Tap banner v statusbaru → navigate to `/paywall?canDismiss=1` (slide-up with X close).

### 🟡 12.5 Renew z lapsed stavu
1. V lapsed mode → tap Renew banner nebo Profile → Renew.
2. Paywall (canDismiss=1) → Subscribe.
3. Po purchase: status → 'active', banner zmizí.
4. Pending changes v `_sync_queue` (které se nepushed během lapse) by se měly pushnout při next syncCycle.
5. Photos v image cache (které byly bez upload during lapse) — **TODO:** deferred upload není implementován; tyhle items zůstanou bez image_url, user by musel re-attach.

### 🔴 12.6 Subscribe cancelled mid-flow
1. Tap Subscribe → iOS sheet.
2. Cancel sheet.
3. App zůstane na paywallu, žádný error alert (cancel je tichý).

### 🔴 12.7 Network failure během refresh
1. Vypni internet.
2. Restart app → cached state se načte z AsyncStorage → user pokračuje s posledním známým stavem.
3. Žádný crash, žádný hang.

### 🟡 12.8 Family Sharing
1. iPhone A: Sign in jako Family Organizer Apple ID. Subscribe normálně.
2. iPhone B: Sign in jako jiný Family member Apple ID.
3. App B login → paywall → tap Subscribe → iOS sheet **měl by ukázat "Get with Family Sharing"** místo "Subscribe".
4. Tap → entitlement se aktivuje zdarma → app vstoupí.
5. `useSubscription` na iPhone B vrátí status='active' s `ownershipType: 'familyShared'` (pokud expo-iap to expose).

### 🟢 12.9 Manage Subscription deep link
1. Profile → Manage → otevře se iOS Settings → Subscriptions sheet.
2. Vrať se do app → app pokračuje normálně.

### Backend (Supabase)

### 🟢 12.10 subscription_expires_at push
1. Po každém refresh v useSubscription se hodnota mirror-uje do `public.users.subscription_expires_at`.
2. Ověř v Supabase Dashboard → Table Editor → users → tvůj řádek má `subscription_expires_at` nastavené.

### 🟢 12.11 30-day TTL cleanup
1. V Supabase SQL Editoru ručně nastav `subscription_expires_at = now() - interval '31 days'` pro testovacího usera, který má warehouse.
2. Run: `select * from public.cleanup_lapsed_cloud_data();` — měl by vrátit `warehouses_deleted >= 1`.
3. Ověř, že warehouse + child boxes + items jsou pryč v DB.
4. Image files v storage.objects zůstanou (orphans) — TODO: Edge Function sweep.
5. App na tom userově zařízení **neztrácí local data** — jen na cloud-side cleanup.

### 🔴 12.12 Shared warehouse cleanup
1. Setup: warehouse má 2 členy: A (lapsed >30d) + B (active).
2. Run cleanup → warehouse **NESMÍ** být smazán (protože B je active).
3. Pak nastav B taky lapsed >30d → run cleanup → warehouse pryč.
