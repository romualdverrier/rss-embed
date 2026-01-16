# RSS Embed

Petit utilitaire web permettant d’afficher un flux RSS sous forme de widgets intégrables (iframe), avec un rendu propre et lisible.

Ce projet a été développé pour répondre à un **besoin spécifique d’intégration de flux de veille dans des environnements fermés** (type LMS / intranet), où l’accès direct aux flux RSS ou l’usage de scripts externes est limité.

Il ne s’agit pas d’un produit générique ni d’un service public :  
le code est publié à titre informatif et expérimental.

---

## Fonctionnalités principales

- Affichage d’un flux RSS sous forme de :
  - liste verticale (type agrégateur)
  - carrousel
- Support de plusieurs formats de flux (RSS / Atom)
- Récupération automatique des images quand elles sont présentes
- Placeholder visuel propre lorsqu’il n’y a pas d’image
- Affichage optionnel de la source et de la date
- Formatage des dates en français
- Paramétrage simple via URL (query parameters)
- Restriction volontaire des flux autorisés (whitelist côté code)

---

## Exemple d’usage

Le widget est conçu pour être intégré sous forme d’iframe, par exemple :

```html
<iframe
  src="https://romualdverrier.github.io/rss-embed/?feed=https%3A%2F%2Fedunumrech.hypotheses.org%2Ffeed&layout=list&limit=20&header=0"
  width="100%"
  height="900"
  style="border:0;">
</iframe>
