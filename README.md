# Flux — persoonlijke boekhouding

Flux is een eenvoudige webapp om je persoonlijke financiën bij te houden. Ze draait volledig in je browser:
je hebt geen server, account of installatie nodig, en je gegevens verlaten je computer niet (ze worden bewaard in de `localStorage` van je browser).

## Starten

- **Snelst:** open `index.html` met een dubbelklik in je browser.
- **Of via een lokale webserver:** `npm start` (of `python3 -m http.server 8080`) en surf naar <http://localhost:8080>.
- Wil je het eerst uitproberen? Klik op **Demogegevens laden** (op het overzicht of bij *Instellingen*).

## Functies

| Functie | Waar | Hoe het werkt |
|---|---|---|
| **Automatische categorisatieregels** | *Regels* | Regels op tegenpartij, mededeling, IBAN of eender welk veld, met *bevat / is gelijk aan / begint met / regex*. Optioneel enkel voor uitgaven/inkomsten of één rekening. De eerste passende regel (volgorde aanpasbaar met ▲▼) wint. Live voorbeeld van welke transacties overeenkomen. Manueel gecategoriseerde transacties worden niet overschreven (tenzij je dat aanvinkt). Vanuit een transactie kan je met **Regel maken…** meteen een regel aanmaken. |
| **Opsplitsen van transacties** | Transactie openen → *Opsplitsen* | Verdeel één betaling over meerdere categorieën (bv. € 40 voeding + € 15 huishouden). Flux toont live hoeveel er nog te verdelen is; een rest gaat naar de hoofdcategorie. |
| **Interne overschrijvingen uitsluiten** | *Instellingen → Eigen rekeningen* | Vul de IBAN's van je eigen rekeningen in. Betalingen naar/van die IBAN's worden als interne overschrijving herkend en beide kanten (bv. zicht → spaar) worden aan elkaar gekoppeld. Ze tellen niet mee als inkomen of uitgave. Per transactie kan je dit ook manueel op *ja/nee* zetten. |
| **Terugbetalingen** | Inkomende transactie openen → *Terugbetaling van een uitgave* | Koppel een Tikkie/Payconiq/terugstorting aan de oorspronkelijke uitgave. Flux stelt passende uitgaven voor. Het bedrag vermindert de uitgave in dezelfde categorie én maand (proportioneel bij gesplitste uitgaven) in plaats van als inkomen te tellen. Inkomsten met woorden als *tikkie, payconiq, terugbetaling…* worden gemarkeerd als *mogelijke terugbetaling*. |
| **Budgetten en waarschuwingen** | *Budgetten* | Maand- of jaarlimiet per categorie met instelbare waarschuwingsdrempel. Statussen *Op schema / Bijna op / Overschreden*, resterend bedrag, wat je nog per dag kan uitgeven, prognose tegen het einde van de periode en een markering die toont hoever de periode gevorderd is. |
| **Vaste lasten en abonnementen** | *Vaste lasten* | Automatische detectie van terugkerende betalingen (wekelijks t.e.m. jaarlijks) op basis van tegenpartij en regelmaat. Toont vast/variabel bedrag, volgende vervaldatum, verwacht bedrag, status (*binnenkort, gemist?, gestopt?*), seizoenspatronen (bv. *hoger in de winter* bij energie) en een maandprofiel. Bevestigen, hernoemen of negeren kan. Ook het totaal aan vaste lasten per maand/jaar. |
| **Manuele transacties en correcties** | *+ Manuele transactie*, of klik op een transactie | Voeg contante uitgaven toe (standaard op de rekening *Cash*) of corrigeer geïmporteerde transacties (datum, bedrag, tegenpartij, mededeling, IBAN, notitie). |

Daarnaast:

- **CSV-import** van bankexports (KBC, BNP Paribas Fortis, Belfius, ING, Argenta, …): scheidingsteken, kopregel en kolommen worden automatisch herkend (aparte debet/credit-kolommen worden ook ondersteund), Belgische bedragnotatie (`1.234,56`) en datums (`dd/mm/jjjj`), dubbels worden overgeslagen. Je ziet vooraf een voorbeeld met de categorieën die de regels zouden toekennen.
- **Overzicht** per maand met inkomsten, uitgaven, saldo, uitgaven per categorie, budgetten, komende vaste lasten en een grafiek van de laatste 12 maanden.
- **Back-up** als JSON (downloaden en terugzetten) en export van transacties naar CSV.

## Projectstructuur

```
index.html        de pagina
css/style.css     opmaak (met automatische donkere modus)
js/core.js        rekenlogica zonder DOM: regels, splitsingen, transfers, terugbetalingen, budgetten, detectie van vaste lasten, CSV
js/store.js       opslag, standaardcategorieën/-regels en demodata
js/app.js         gebruikersinterface
tests/            unit tests voor de kernlogica
```

Bedragen worden intern als gehele centen opgeslagen (negatief = uitgave) om afrondingsfouten te vermijden.

## Tests

```
npm test
```

(vereist Node.js 18 of nieuwer; er zijn geen externe afhankelijkheden)

## Let op

Omdat alles in de browser bewaard wordt, zijn je gegevens gebonden aan die ene browser op dat ene toestel. Het wissen van je browsergegevens wist ook Flux. Maak dus regelmatig een back-up via *Instellingen → Back-up downloaden*.
