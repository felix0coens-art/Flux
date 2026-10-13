# Flux — persoonlijke boekhouding

Flux houdt je persoonlijke boekhouding bij: inkomsten en uitgaven, budgetten, vaste lasten en abonnementen.
Je host Flux zelf en gebruikt het op al je toestellen: laptop, tablet en iPhone (als app op je beginscherm).
Je gegevens staan op je eigen server, niet bij een derde partij.

---

## Functies

**Inkomsten**
- **Inkomstenbronnen.** Elke inkomstencategorie is een bron. Standaard zijn er drie: *Loon*, *Bijberoep / zelfstandige* en *Andere inkomsten*. Je kan ze hernoemen en er bronnen bij maken.
- **Kosten aftrekken van inkomsten.** Een uitgavecategorie kan je koppelen aan een inkomstenbron, bijvoorbeeld *Kosten bijberoep* aan *Bijberoep*. Die kosten worden dan van die bron afgetrokken en tellen niet mee bij je gewone uitgaven.
- **Afgehouden kosten.** Kreeg je € 900 binnen terwijl je € 1.000 factureerde en het platform € 100 commissie afhield? Splits de ontvangst in `1000` (bron) en `-100` (kostcategorie).
- **Tabblad *Inkomsten*.** Per bron zie je bruto, kosten en netto, per maand en per jaar. Je ziet ook wanneer de volgende betaling verwacht wordt, bijvoorbeeld je loon op de 25ste.

**Uitgaven en beheer**
- **Automatische categorisatieregels** op tegenpartij, mededeling of IBAN. Beschikbare voorwaarden: *bevat*, *is gelijk aan*, *begint met*, *naam bevat* (ongevoelig voor leestekens) en *regex*.
- **Online opzoeken in plaats van een vaste lijst.** Flux bevat geen lijst van winkels of bedrijven. Een onbekende tegenpartij wordt online opgezocht:
  - **Wikidata**: wat voor organisatie het is, bijvoorbeeld "Vlaamse vervoersmaatschappij" of "Belgische supermarktketen".
  - **OpenStreetMap**: wat voor zaak het is, bijvoorbeeld `shop=supermarket` of `amenity=pharmacy`.
  - Optioneel **Claude (AI) met webzoekfunctie**, voor afgekorte of onduidelijke namen op je rekeninguittreksel.

  Het resultaat wordt gekoppeld aan je categorieën via **zoekwoorden per categorie**. Die beschrijven een *soort* zaak (bijvoorbeeld "supermarket, bakkerij"), geen merknamen, en je past ze aan bij *Instellingen*. Je keurt elk voorstel zelf goed. Wat je goedkeurt, wordt een regel, zodat volgende transacties van die tegenpartij vanzelf goed staan. Na een import stelt Flux voor om nieuwe tegenpartijen op te zoeken. In een transactie kan je ook op **🔎 Zoek online** klikken.
- **Opsplitsen van transacties** over meerdere categorieën.
- **Interne overschrijvingen** tussen je eigen rekeningen worden herkend aan de IBAN en niet meegeteld als inkomen of uitgave.
- **Terugbetalingen.** Een Tikkie of Payconiq koppel je aan de oorspronkelijke uitgave. Die uitgave wordt dan verminderd, in plaats van dat de terugbetaling als inkomen telt.
- **Budgetten per maand of jaar**, met waarschuwingen, het resterende bedrag per dag en een prognose.
- **Vaste lasten en abonnementen** worden automatisch herkend, met de volgende vervaldatum, het verwachte bedrag en seizoenspatronen.
- **Manuele transacties en correcties**, **CSV-import** van Belgische banken, **back-up** en export.

**Op al je toestellen**
- Aanmelden met gebruikersnaam en wachtwoord.
- Synchronisatie tussen toestellen. Werkt ook **offline**: wat je zonder verbinding aanpast, wordt samengevoegd zodra je weer online bent. Per transactie, regel of budget wint de nieuwste versie, dus wijzigingen op twee toestellen overschrijven elkaar niet.
- Installeerbaar als app op je iPhone of Android (PWA).

---

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

### AI-classificatie (optioneel)

Zonder API-sleutel zoekt Flux gratis in Wikidata en OpenStreetMap. Met een API-sleutel van [console.anthropic.com](https://console.anthropic.com) (`ANTHROPIC_API_KEY`) laat Flux daarnaast Claude elke tegenpartij classificeren. Claude zoekt op het web als het een naam niet kent. Dit kost per opzoeking een paar cent aan API-gebruik. Daarom zoekt Flux enkel op wanneer jij dat vraagt, en per tegenpartij één keer, niet per transactie. De sleutel blijft op je server, en het verzoek gebruikt de automatische terugval naar een ander model als het eerste weigert.

### Back-ups

Alle gegevens staan in de datamap: één JSON-bestand per gebruiker, plus `users.json` met de wachtwoord-hashes en `sessions.json`. Maak een back-up van die map, of van het Docker-volume `flux-data`. In de app kan je ook een back-up downloaden via *Instellingen → Back-up downloaden*.

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
js/store.js                lokale opslag, standaardcategorieën, demodata
js/sync.js                 synchronisatie met de server (offline first)
js/app.js                  gebruikersinterface
server/server.js           HTTP-server: app, login, synchronisatie, opzoeken (met cache)
server/ai.js               optionele classificatie via Claude
tests/                     tests (npm test)
```

Bedragen staan intern als gehele centen (negatief = uitgave). Je kan lokaal starten met `npm start` en dan surfen naar <http://localhost:8080>.
