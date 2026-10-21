# Mijn Nieuws

Een simpele, persoonlijke nieuwspagina. Een script haalt koppen op uit RSS-feeds, de pagina toont ze met filters op onderwerp en zoeken.

## Gebruik

1. Haal het nieuws op:

   ```bash
   node scripts/fetch-news.mjs
   ```

2. Start een lokale server in deze map (de pagina laadt `data/news.json`, dus openen via `file://` werkt niet):

   ```bash
   npx serve .
   ```

3. Open de adres die verschijnt (meestal http://localhost:3000).

## Feeds aanpassen

Bewerk `feeds.json`. Elke feed heeft een `name`, `url` en `topic`. Het `topic` bepaalt welke filterknop het artikel krijgt. `maxPerFeed` bepaalt hoeveel artikelen per feed worden meegenomen.
