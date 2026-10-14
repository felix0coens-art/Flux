# Flux — persoonlijke boekhouding

Flux houdt je persoonlijke boekhouding bij: bankrekeningen, inkomsten en uitgaven, voorschotten aan vrienden, budgetten, vaste lasten en je beleggingen bij Degiro.
Je host Flux zelf en gebruikt het op al je toestellen: laptop, tablet en iPhone (als app op je beginscherm).
Je gegevens staan op je eigen server, niet bij een derde partij.

---

## Hoe Flux werkt

Flux heeft zes tabbladen:

| Tabblad | Waarvoor |
|---|---|
| **Overzicht** | Een **tijdslijn met schuifbalk** om eender welke periode te kiezen (of snel: deze maand, dit jaar, 12 maanden, …). Voor die periode: netto inkomsten, uitgaven, wat er overblijft, wat je belegde, je vermogen (banksaldi + beleggingen + wat vrienden je nog schuldig zijn) en wat aandacht vraagt. |
| **Bank** | Je rekeningen, de **opgeladen bestanden** en alle transacties. Hier laad je de CSV van je bank op en koppel je elke transactie aan wat ze is. |
| **Inkomsten** | Je **eigen inkomstenbronnen** (je kiest zelf naam en aantal; hernoemen en verwijderen kan op elke kaart). Per bron: bruto, kosten en netto. Daaronder de ontvangen bedragen, om te koppelen. |
| **Uitgaven** | Per categorie, budgetten, vaste lasten (automatisch herkend) en alle betalingen, om te koppelen. |
| **Beleggingen** | Je Degiro-portefeuille: waarde, inleg, winst, dividend, **TWR** en **MWR**, een grafiek door de jaren met elke bijstorting, en het rendement per jaar. |
| **Instellingen** | Account, rekeningen, categorieën, automatische regels, online opzoeken, back-up. |

### Altijd duidelijk wat er in Flux zit

- **Elk bestand is een import.** Per import zie je de bestandsnaam, de bank, de rekening, de periode, het aantal toegevoegde transacties en het aantal rijen dat overgeslagen werd. Bij elke transactie zie je uit welk bestand ze komt, of dat je ze manueel invoerde.
- **Hetzelfde bestand kan geen tweede keer opgeladen worden.** Flux herkent de inhoud, dus ook als je het bestand hernoemde.
- **Overlappende bestanden zijn geen probleem.** Laad je bijvoorbeeld september–oktober op terwijl september er al in zit, dan worden enkel de nieuwe rijen toegevoegd. Flux toont vooraf hoeveel er nieuw is en hoeveel er al in zat, en uit welk bestand.
- **Elke import kan je ongedaan maken.** In het tabblad Bank verwijder je met één klik alle transacties van één bestand.
- **Voorbeeldgegevens zitten in een aparte zandbak** (*Instellingen → Voorbeeldmodus*). Zolang die aanstaat zie je bovenaan een duidelijke balk. Je eigen gegevens worden er nooit door aangeraakt en de zandbak wordt niet gesynchroniseerd.
- **Bij de update naar deze versie zijn alle vroegere gegevens gewist**, zoals je vroeg: lokaal in elke browser en op de server. Op de server blijft een back-up bewaard (`user-….json.v2.bak` in de datamap), maar Flux zet die nooit vanzelf terug.

### Bankbestanden: KBC/CBC en Argenta

Beide banken worden automatisch herkend, inclusief de IBAN van je rekening. Bij de eerste import maakt Flux de rekening aan. Bevat een KBC-export meerdere rekeningen, dan worden die per rekening opgesplitst.

- **KBC/CBC**: KBC Touch op de computer → *Rekeningen* → je rekening → *Verrichtingen* → periode kiezen → *Exporteren* → **CSV**. Het saldo wordt automatisch overgenomen uit de saldokolom.
- **Argenta**: internetbankieren → *Rekeningen* → je rekening → *Verrichtingen* → *Downloaden* → **CSV**. Elke rij heeft een unieke referentie, dus dubbels worden exact herkend. Het saldo geef je één keer zelf in, via de rekening → *Bewerk*.
- **Andere banken** gaan ook: je duidt dan zelf de kolommen aan.

Menunamen kunnen licht verschillen per versie van de app of website.

### Een transactie koppelen

Elke transactie staat eerst op **Te verwerken**. Met één keuzelijst zeg je wat ze is:

- een **inkomst** (en van welke bron) of een **uitgave** (en welke categorie);
- **↗ Voorgeschoten voor iemand**: je betaalde iets voor een vriend. Dit telt niet als uitgave; het komt op de lijst "wie is mij nog wat schuldig". Betaalde je ook voor jezelf? Splits de betaling dan, bijvoorbeeld € 50 restaurant voor jezelf en 2 × € 50 voorschot voor Pieter en Sofie;
- **↙ Terugbetaling van een voorschot**: een Tikkie of overschrijving van een vriend. Dit telt niet als inkomen en verkleint wat die persoon je nog schuldig is. Je koppelt het aan een specifiek voorschot, of enkel aan de naam: dan wordt het op diens oudste openstaande voorschotten afgeboekt;
- **↩ Terugbetaling van een uitgave**: had je de hele rekening als jouw uitgave geboekt, dan wordt die uitgave verminderd;
- **📈 Belegging**: stortingen naar of opnames van Degiro. Overschrijvingen naar Degiro/flatex worden automatisch zo herkend;
- **↔ Eigen rekening**: overschrijvingen tussen je eigen rekeningen worden automatisch herkend op IBAN;
- **✂ Opsplitsen** over meerdere categorieën.

Koppel je een tegenpartij voor het eerst, dan verschijnt **⚙ Altijd zo**: één klik en volgende transacties van die tegenpartij worden vanzelf gekoppeld. Onbekende tegenpartijen kan je ook **online laten opzoeken** (Wikidata, OpenStreetMap, optioneel AI).

### Inkomsten met kosten

Elke inkomstencategorie is een **bron**. Flux maakt er geen vooraf aan: je maakt ze zelf aan in het tabblad *Inkomsten*, of rechtstreeks vanuit een transactie via *+ Nieuwe inkomstenbron…*. Een **kostcategorie** koppel je aan een bron, en die kosten worden dan van die bron afgetrokken: netto = bruto − kosten. Werd een kost al afgehouden van een betaling, bijvoorbeeld een commissie van een platform? Splits de ontvangst dan in `1000` (bron) en `-100` (kost).

### Vaste lasten

Vaste lasten zijn geen apart tabblad. Ze worden **automatisch herkend** in je transacties: minstens drie betalingen aan dezelfde tegenpartij met een vast ritme. Je ziet ze als 🔁-label bij die transacties, en bij *Uitgaven* staat een overzicht met de volgende vervaldatum, het verwachte bedrag en eventuele seizoenspatronen. Verwachte inkomsten, zoals je loon, staan bij *Inkomsten*.

## Beleggingen (Degiro)

### Rechtstreeks ophalen

Dit kan wanneer Flux op je eigen server draait. Ga naar *Beleggingen → Ophalen uit Degiro…* en log in met je Degiro-gebruikersnaam, je wachtwoord en je 2FA-code. Flux haalt dan je portefeuille, transacties en kasbewegingen op.

- Je wachtwoord en 2FA-code worden **niet bewaard**. Je logt elke keer opnieuw in, en de Degiro-sessie wordt meteen weer afgesloten.
- Degiro heeft **geen officiële API**. Deze koppeling gebruikt dezelfde webdiensten als de Degiro-website. Ze kan stoppen met werken als Degiro iets wijzigt, en ze is niet door Degiro goedgekeurd. De exportbestanden hieronder werken altijd.
- Elke keer ophalen voegt een waarderingspunt toe aan de grafiek. Historische standen levert deze weg niet: daarvoor gebruik je de portefeuille-export per 31 december.

### Wat moet je exact exporteren uit Degiro?

Op de Degiro-website:

1. **Rekeningoverzicht** (nodig voor stortingen, dividend, kosten en het rendement): *Inbox* → *Rekeningoverzicht*. Kies als periode **van de dag van je allereerste storting tot vandaag** → *Exporteren* → **CSV** (`Account.csv`).
2. **Transacties** (aan- en verkopen, voor de aankoopprijs per positie): *Inbox* → *Transacties* → dezelfde volledige periode → *Exporteren* → **CSV** (`Transactions.csv`).
3. **Portefeuille van vandaag**: *Portefeuille* → *Exporteren* → **CSV** (`Portfolio.csv`). Kies bij het opladen de datum van vandaag.
4. **Portefeuille op elke 31 december** sinds je begon: bij het exporteren van je portefeuille kies je de **datum** 31/12/jjjj. Laad elk bestand op met die datum. Dit is nodig voor een correct rendement per jaar en een precieze TWR. Wil je een fijnere grafiek, exporteer dan ook per kwartaal of per maand.

Je kan alle bestanden tegelijk opladen; Flux herkent zelf welk bestand wat is. Hetzelfde bestand twee keer opladen voegt niets dubbel toe.

### Rendement: TWR en MWR

- **MWR / MWRR** (money-weighted, berekend als XIRR) is **jouw persoonlijke rendement**. Het houdt rekening met wanneer en hoeveel je stortte. Deze berekening is exact: ze heeft enkel al je stortingen en opnames nodig, plus de huidige waarde.
- **TWR** (time-weighted) is het **rendement van je beleggingen zelf**, los van je stortingen. Dit cijfer vergelijk je met een index of fonds. Flux berekent het per periode tussen twee waarderingen (Modified Dietz) en ketent die periodes aan elkaar. Met een portefeuille-export per 31/12 is elk jaar correct; ontbreekt er een jaareinde, dan toont Flux welke export nodig is.
- **Per jaar** zie je de beginwaarde, stortingen, opnames, eindwaarde, het resultaat (= eind − begin − netto stortingen), de TWR, de MWR en het dividend. Voor het lopende jaar is dat het rendement tot nu, niet omgerekend naar een jaar.
- Dividend en kosten blijven binnen de portefeuille en tellen dus mee in het rendement. Ze tellen niet als stortingen.

## Hosten

Flux bestaat uit één kleine Node.js-server, zonder database. Je hebt **HTTPS** nodig: dat beschermt je wachtwoord, en zonder HTTPS kan je Flux niet als app op je iPhone installeren. Kies een van deze drie manieren.

### Optie A — Thuis, privé en gratis, met Tailscale (aanbevolen om te starten)

Flux draait op een computer, NAS of Raspberry Pi bij je thuis. Je bereikt die vanaf je iPhone via [Tailscale](https://tailscale.com), een gratis privénetwerk tussen je eigen toestellen. Flux is dan niet zichtbaar voor de rest van het internet.

1. Installeer [Docker](https://docs.docker.com/get-docker/) op de computer die Flux moet draaien, en start Flux:
   ```bash
   git clone https://github.com/felix0coens-art/Flux.git && cd Flux
   docker build -t flux .
   docker run -d --name flux --restart unless-stopped -p 127.0.0.1:8080:8080 -v flux-data:/data flux
   docker logs flux        # toont de setupcode
   ```
   Heb je liever geen Docker? Installeer [Node.js](https://nodejs.org) 20 of nieuwer en voer `npm ci --omit=dev && npm start` uit.
2. Installeer Tailscale op die computer en op je iPhone, en meld je op beide aan met hetzelfde account.
3. Zet HTTPS aan op de computer:
   ```bash
   tailscale serve --bg 8080
   ```
   Tailscale toont een adres zoals `https://mijn-pc.tail1234.ts.net`.
4. Open dat adres, maak je account aan met de setupcode en installeer de app op je iPhone (zie hieronder).

Nadeel: de computer moet aan staan om te synchroniseren. Op je iPhone kan je zonder verbinding wel verder werken; de wijzigingen worden later verstuurd.

### Optie B — Op een server in de cloud, met je eigen domein

Bijvoorbeeld een kleine VPS van een paar euro per maand bij Hetzner, OVH of DigitalOcean.

1. Laat een (sub)domein naar het IP-adres van je server wijzen, bijvoorbeeld `flux.jouwdomein.be`.
2. Op de server:
   ```bash
   git clone https://github.com/felix0coens-art/Flux.git && cd Flux
   cp .env.example .env      # vul DOMAIN in (en eventueel ANTHROPIC_API_KEY)
   docker compose up -d
   docker compose logs flux  # toont de setupcode
   ```
   Caddy vraagt automatisch een HTTPS-certificaat aan.
3. Open `https://flux.jouwdomein.be` en maak je account aan.

### Optie C — Een andere hostingdienst

Elke dienst die een Docker-image kan draaien met een **blijvende schijf** (persistent volume), zoals Fly.io, Railway of Render. Koppel die schijf aan `/data` en stel poort `8080` in. Zet `FLUX_SECURE_COOKIES=1` en `FLUX_TRUST_PROXY=1`, want die diensten zetten zelf HTTPS ervoor. De setupcode staat in de logs.

### Account aanmaken

Bij de eerste start bestaat er nog geen account. De server toont dan in zijn log een **setupcode**; die vul je samen met je gebruikersnaam en wachtwoord in op het welkomstscherm. Je kan het account ook meteen bij de eerste start laten aanmaken met de omgevingsvariabelen `FLUX_USERNAME` en `FLUX_PASSWORD`. Wil je een extra gebruiker, bijvoorbeeld je partner, met eigen gegevens? Voer dan `docker exec -it flux node server/server.js adduser naam` uit (zonder Docker: `npm run adduser -- naam`).

### Flux op je iPhone installeren

1. Open het adres van je Flux in **Safari** en meld je aan.
2. Tik op de deelknop (vierkant met pijl) en kies **Zet op beginscherm**.
3. Flux staat nu als app op je beginscherm, schermvullend en ook zonder verbinding te gebruiken.

Op Android gaat het via Chrome → menu → **App installeren**.

### Instellingen van de server

| Variabele | Betekenis |
|---|---|
| `PORT` | poort (standaard `8080`) |
| `FLUX_DATA_DIR` | map met gegevens (standaard `./data`, in Docker `/data`) |
| `FLUX_USERNAME`, `FLUX_PASSWORD` | maakt bij de eerste start meteen dit account aan |
| `FLUX_SECURE_COOKIES=1` | cookies enkel via HTTPS (zet dit aan achter een HTTPS-proxy) |
| `FLUX_TRUST_PROXY=1` | het IP-adres van de bezoeker uit de proxy halen (voor de beperking op foute aanmeldpogingen) |
| `ANTHROPIC_API_KEY` | optioneel: tegenpartijen laten classificeren door Claude |
| `FLUX_AI_MODEL` | optioneel: ander Claude-model (standaard `claude-opus-5-5`) |
| `FLUX_BACKUP_DAYS` | aantal dagelijkse back-ups dat bewaard blijft (standaard `30`) |

### AI-classificatie (optioneel)

Zonder API-sleutel zoekt Flux gratis in Wikidata en OpenStreetMap. Met een API-sleutel van [console.anthropic.com](https://console.anthropic.com) (`ANTHROPIC_API_KEY`) laat Flux daarnaast Claude elke tegenpartij classificeren. Claude zoekt op het web als het een naam niet kent. Dit kost per opzoeking een paar cent aan API-gebruik. Daarom zoekt Flux enkel op wanneer jij dat vraagt, en per tegenpartij één keer, niet per transactie. De sleutel blijft op je server, en het verzoek gebruikt de automatische terugval naar een ander model als het eerste weigert.

### Flux bijwerken zonder je gegevens te verliezen

Je gegevens en de code staan **los van elkaar**:

- de **code** zit in deze Git-repository (en in de Docker-image);
- je **gegevens** zitten in de datamap van de server. Bij Docker is dat het volume `flux-data`, en `docker compose down`, een rebuild of een nieuwe image laten dat ongemoeid. Op elk toestel staat daarnaast een kopie in de browser.

Een nieuwe versie installeren:

```bash
cd Flux
git pull                         # nieuwe code ophalen
docker compose up -d --build     # opnieuw bouwen en herstarten; het volume flux-data blijft staan
# zonder Docker:  npm ci --omit=dev  en de server herstarten
```

Open daarna Flux op je toestellen. Een oude versie in de cache wordt automatisch vervangen.

Garanties in de code:

- **Een update wist nooit nog gegevens.** De eenmalige opkuis van versie 3 is gebeurd. Nieuwe velden worden voortaan bij het laden toegevoegd (`migrate()` in `js/store.js`), niet door gegevens te wissen.
- **Automatische dagelijkse back-up op de server**: bij de eerste wijziging van elke dag wordt de vorige stand bewaard in `data/backups/`. De laatste 30 dagen blijven staan (instelbaar met `FLUX_BACKUP_DAYS`).
- Download voor een grote update gerust ook zelf een back-up via *Instellingen → Back-up downloaden*.

Wil je **zelf aan de code werken of iets uitproberen**? Draai dan een tweede server met een kopie van je gegevens, zodat je echte gegevens nooit geraakt worden:

```bash
cp -r data data-test
FLUX_DATA_DIR=./data-test PORT=8081 npm start     # proefversie op http://localhost:8081
```

Of gebruik de voorbeeldmodus in de app.

### Back-ups

Alle gegevens staan in de datamap: één JSON-bestand per gebruiker, `users.json` met de wachtwoord-hashes, `sessions.json`, en `backups/` met de dagelijkse back-ups. Maak een back-up van die map, of van het Docker-volume `flux-data`. In de app kan je ook een back-up downloaden via *Instellingen → Back-up downloaden*.

### Beveiliging

- Wachtwoorden worden opgeslagen met scrypt. Van de sessietokens wordt enkel een hash bewaard, en de sessiecookie is `HttpOnly` en `SameSite`.
- Na 10 foute aanmeldpogingen per kwartier wordt een IP-adres tijdelijk geblokkeerd.
- De server stuurt strikte beveiligingsheaders mee (CSP, `X-Frame-Options`) en serveert enkel de app-bestanden.
- Bij het online opzoeken wordt enkel de naam van de tegenpartij verstuurd. Met AI gaat ook de eerste 120 tekens van de mededeling mee.

---

## Zonder server (enkel lokaal)

Dubbelklik je op `index.html`, dan werkt Flux volledig in die ene browser, zonder account en zonder synchronisatie. Het online opzoeken gebeurt dan rechtstreeks vanuit de browser, en enkel via Wikidata en OpenStreetMap. Zet je later een server op, dan vraagt Flux bij de eerste aanmelding in dezelfde browser of je bestaande gegevens naar je account mogen.

## Ontwikkeling

```
index.html, css/, icons/   de app
manifest.webmanifest, sw.js  installeerbaar en offline (PWA)
js/core.js                 rekenlogica: regels, splitsingen, transfers, terugbetalingen, inkomsten, budgetten,
                           vaste lasten, CSV, synchronisatie (samenvoegen), categorie kiezen uit online info
js/lookup.js               online opzoeken (Wikidata, OpenStreetMap)
js/banks.js                bankimport: profielen KBC/Argenta, dubbels, imports ongedaan maken
js/invest.js               Degiro-exports, portefeuille, TWR/MWR, rendement per jaar
js/store.js                lokale opslag, standaardcategorieën, demodata
js/sync.js                 synchronisatie met de server (offline first)
js/app.js                  gebruikersinterface
server/server.js           HTTP-server: app, login, synchronisatie, opzoeken (met cache)
server/ai.js               optionele classificatie via Claude
server/degiro.js           rechtstreekse Degiro-koppeling
tests/                     tests (npm test)
```

Bedragen staan intern als gehele centen (negatief = uitgave). Je kan lokaal starten met `npm start` en dan surfen naar <http://localhost:8080>.
