# iBlock

Bloqueur façon **uBlock Origin** pour **Safari sur iPad** (et iPhone), sous forme de userscripts pour l'app gratuite [Userscripts](https://apps.apple.com/app/userscripts/id1463298887).

> Version 0.1 : phases 1 et 2 (socle + anti pop-ups). Voir la [feuille de route](#feuille-de-route).

## Ce que fait iBlock

| Fonction | Détail |
|---|---|
| **Anti pop-ups** | Bloque les fenêtres ouvertes sans votre accord, les popunders au premier clic, les liens détournés et les liens invisibles cliqués par script. Une notification permet d'ouvrir quand même. |
| **Calques pièges** | Retire les liens transparents qui recouvrent toute la page pour vous envoyer vers une pub. |
| **Bannières cookies** | Clique sur « Tout refuser » quand c'est possible (OneTrust, Didomi, Cookiebot, Axeptio, tarteaucitron…), sinon masque la bannière. Débloque le défilement de la page. |
| **Publicités** | Masque les emplacements publicitaires connus (Google, Taboola, Outbrain…). |
| **Nuisances** | Newsletters, demandes de notifications, « Se connecter avec Google »… |
| **Mes filtres** | Vos propres règles en **syntaxe uBlock Origin**, y compris les filtres procéduraux et les scriptlets. |
| **Zapper** | Touchez un élément pour le supprimer, une fois ou pour toujours. |
| **Par site** | Un interrupteur pour désactiver iBlock sur un site. |

## Installation (5 minutes)

### 1. L'app Userscripts
1. Installez **Userscripts** depuis l'App Store (gratuite, open source).
2. Ouvrez l'app une fois et choisissez un dossier de sauvegarde (par exemple « Sur mon iPad › Userscripts »).
3. **Réglages › Apps › Safari › Extensions › Userscripts** : activez l'extension, puis dans « Autorisations » choisissez **Toujours autoriser** sur **Tous les sites web**.

### 2. Les deux scripts d'iBlock
iBlock est composé de **deux scripts** à installer tous les deux :

| Script | Rôle |
|---|---|
| **iBlock** | Interface, filtres, cookies, zapper |
| **iBlock (page)** | Anti pop-ups et scriptlets (doit tourner dans le contexte de la page) |

Pour chacun :
1. Ouvrez le lien dans **Safari** :
   - **iBlock** : https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock.user.js
   - **iBlock (page)** : https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock-page.user.js
2. Touchez l'icône des extensions dans la barre d'adresse (pièce de puzzle, ou « Aa »), puis **Userscripts**.
3. Touchez **Installer**.

Rechargez ensuite une page web : un petit **bouclier bleu** apparaît en bas à droite.

### 3. Mises à jour
Les scripts se mettent à jour automatiquement depuis ce dépôt (l'app Userscripts vérifie régulièrement). Vous pouvez forcer la vérification depuis l'extension Userscripts dans Safari.

## Utilisation

- **Bouclier bleu** : touchez-le pour ouvrir le panneau. Faites-le glisser pour le déplacer.
- **Interrupteur** : désactive iBlock sur le site courant (rechargement nécessaire).
- **Zapper un élément** : touchez un élément de la page, « Plus large » pour remonter au bloc parent, puis « Supprimer » (cette fois) ou « Toujours masquer » (crée un filtre).
- **Débloquer le défilement** : si une page reste figée après une pop-up.
- **Journal** : ce qu'iBlock a fait sur la page.
- **Mes filtres** : vos règles personnelles.
- **Réglages** (roue dentée) : activer ou désactiver chaque protection, bouton discret, sites désactivés.

## Syntaxe des filtres (compatible uBlock Origin)

```
! Commentaire
##.pub-generique                          masque partout
exemple.fr##.banniere                     masque sur exemple.fr (et ses sous-domaines)
exemple.*##.banniere                      toutes les extensions (.fr, .com…)
~blog.exemple.fr,exemple.fr##.pub         sauf sur blog.exemple.fr
exemple.fr#@#.ad-container                exception
exemple.fr##.carte:has-text(Sponsorisé)   procédural
exemple.fr##.label:upward(.article)       remonte au parent
exemple.fr##.bloc:remove()                supprime du DOM
exemple.fr##.texte:style(color: red)      applique un style
exemple.fr##+js(set-constant, ads.enabled, false)   scriptlet
```

Opérateurs procéduraux pris en charge : `:has-text`, `:upward`, `:remove`, `:style`, `:matches-css`, `:matches-css-before/after`, `:min-text-length`, `:matches-path`, `:matches-attr`, `:remove-attr`, `:remove-class`, `:xpath`, `:watch-attr`, `:if`, `:if-not`, `:has()` et `:not()` procéduraux.

Scriptlets pris en charge : `set-constant`, `abort-on-property-read`, `abort-on-property-write`, `abort-current-script`, `json-prune`, `no-setTimeout-if`, `no-setInterval-if`, `addEventListener-defuser`, `noeval-if`, `nowebrtc`, `no-window-open-if`, `window.open-defuser` (et leurs alias courts : `aopr`, `aopw`, `acs`, `nostif`, `nosiif`, `aeld`, `nowoif`).

Les scriptlets s'appliquent **au rechargement suivant** de la page.

Les **règles réseau** (`||domaine^`) sont ignorées : un userscript ne peut pas bloquer les requêtes réseau. Ce rôle est assuré par un DNS bloquant (voir ci-dessous).

## Recommandé : un DNS bloquant

iBlock masque et neutralise, mais ne peut pas empêcher les téléchargements. Pour bloquer pubs et traqueurs **au niveau réseau** (dans Safari et dans toutes les apps), installez un DNS bloquant gratuit, par exemple **AdGuard DNS** ou **NextDNS**, via son profil de configuration. Un guide détaillé arrivera avec la phase 5.

## Limites connues

- Pas de blocage réseau (voir DNS ci-dessus).
- Les pubs de l'**app** YouTube ne peuvent pas être bloquées. Le **site** YouTube sera traité en phase 4.
- Sans Mac, pas d'outils développeur sur iPad : utilisez le **Journal** d'iBlock pour comprendre ce qui se passe.

## Feuille de route

- [x] **Phase 1** : socle (moteur de filtres uBO, interface tactile, journal, zapper, mes filtres)
- [x] **Phase 2** : pop-ups, calques pièges, bannières cookies, défilement bloqué
- [ ] **Phase 3** : listes de filtres complètes (EasyList, Fanboy Annoyances…), anti-anti-adblock
- [ ] **Phase 4** : YouTube (site web)
- [ ] **Phase 5** : traqueurs et confidentialité (nettoyage des URL, leurres, guide Safari + DNS)
- [ ] **Phase 6** : médias lourds, polices distantes, finitions

## Développement

```
node tools/build-meta.cjs   # régénère les .meta.js après un changement de version
node test/run.cjs           # tests automatisés (Chromium via Playwright)
```

À chaque nouvelle version : augmenter `@version` dans les deux scripts (et `VERSION` dans `iBlock.user.js`), puis lancer `build-meta`.

## Licence

GPL-3.0, comme uBlock Origin.
