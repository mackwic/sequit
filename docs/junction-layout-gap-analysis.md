# Jonctions : analyse des écarts et plan d’implémentation

## Contrat et état initial — 12 septembre 2026

Les scénarios de `tests/scenarios/visual/junctions` sont la référence comportementale,
exécutée par le pipeline réel dans les quatre directions et les biais compatibles.
Le checkout contient déjà ces scénarios, leurs assertions et le rendu des symboles.

Mesure initiale : **403 assertions de scénarios passent, 221 échouent**, sur 624 cas.
Les échecs concernent 17 variantes de jonctions, chacune exécutée 13 fois.

| Sujet                | Contrat attendu                                                                       | Écart initial                                                           |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Rangs                | Une jonction ne consomme aucun rang de nœud                                           | Déjà respecté par le classement topologique                             |
| Intervalle           | Précéder la rangée du premier voisin ordinaire, recherché à travers les jonctions     | Le placement utilise seulement le rang logique de la jonction           |
| Chaînes              | Rails successifs, épaisseur et dégagements cumulés                                    | Toutes les jonctions du rang sont placées côte à côte                   |
| Branches             | Jonctions indépendantes sur un rail commun, alignées sur leur branche                 | Centrage de toute la rangée de jonctions sans tenir compte des voisins  |
| Épaisseur            | Maximum des tailles partageant un rail ; somme des rails successifs                   | Un seul maximum pour tout l’intervalle                                  |
| Quais et croisements | Même règle de partage que les autres objets ; entrées exclusives si croisement        | L’allocateur ne traite que les relations entre nœuds ordinaires voisins |
| Obstacles            | Aucun trajet étranger dans une boîte ou son dégagement                                | Le trajet médian traverse les jonctions et les rangées sautées          |
| Suppression          | Collecter les jonctions sans entrée ou sortie, en cascade, jusqu’à une branche valide | Les commandes laissent des jonctions et des relations orphelines        |

## Stratégie

1. Préparer une structure de jonctions déterministe : voisinage ordinaire récursif,
   intervalle de placement et profondeur de rail, sans modifier les rangs logiques.
2. Réserver les épaisseurs par rail, partager leur maximum dans l’intervalle et
   placer les jonctions selon leur branche. Conserver les dimensions de contenu
   originales pour permettre la récupération de place après suppression.
3. Étendre la réservation des quais et le routage aux jonctions et aux trajets
   traversant des rangées. Réutiliser les primitives de canaux et les règles
   existantes ; distinguer les rails occupés par des rectangles et les traverses.
4. Collecter les jonctions devenues invalides dans les commandes documentaires,
   avant les projections, avec une propagation locale des degrés entrants/sortants.
5. Vérifier les scénarios à chaque étape, ajouter des propriétés sur les chaînes
   et la collecte, puis exécuter les contrôles de qualité et les parcours navigateur.

Les changements doivent préserver le cœur pur, les identifiants, l’ordre
documentaire et les seuils de qualité. Le biais actuel aligne les boîtes dans
leurs bandes ; les rangs et les rangées sont conservés comme notions distinctes.

## Validation et décisions

### Ajustement visuel après la capture

La revue a confirmé que les jonctions doivent rester de petits symboles subordonnés
aux nœuds. La mesure par défaut passe à 16 × 16, les quais à un espacement de 12 et
une marge de 8, le libellé XOR à 6,5 px et le contour à 1,5 px. Une jonction avec trois
entrées passe donc de 144 × 48 à 40 × 16. Ces dimensions sont utilisées par le moteur
et le canvas principal comme par l’atelier ; le symbole reste attaché aux routes.

Le dégagement des jonctions passe de 18 à 12 ; un canal bordant une jonction démarre
à 36 au lieu de 72. Les besoins de croisements conservent leurs rails supplémentaires.
Les scénarios de mesures volontairement surdimensionnées restent des tests du moteur,
distincts de la taille du symbole dans le produit.

Validation de cet ajustement : les 650 cas visuels passent, ainsi que `pnpm check`
avec 2 123 tests, 140 parcours navigateur et les builds. Les captures du rendu
compact ont été vérifiées ; le scénario de croisements conserve toutes ses attaches.

### Réalisation

- Le classement topologique n’est pas modifié. Le voisinage ordinaire est résolu
  sans récursion de pile, puis les jonctions reçoivent un intervalle et une
  profondeur de rail. Le placement aligne les branches et répartit les collisions
  transversales sans modifier l’ordre documentaire.
- Les réservations sont combinées entre toutes les composantes. Une jonction
  épaisse écarte toute la rangée, y compris les branches déconnectées.
- Les canaux sont routés entre des couches temporaires, au moyen de l’allocateur
  existant. Les passages extérieurs évitent les objets des couches sautées. La
  réunion des morceaux conserve les identifiants des relations.
- La collecte est une fonction pure du domaine, utilisée par les commandes de
  suppression de l’atelier. Elle conserve les objets survivants et leurs ordres.
- L’inspection expose les quais, le contenu initial et les rails occupés par les
  jonctions. Les tests navigateur exigent maintenant la réussite des scénarios.
- Le contrôle visuel a révélé que l’atelier réduisait les symboles à la moitié des
  boîtes calculées. Le symbole utilise désormais la boîte réelle et un arrondi
  conservant des faces plates pour les quais, partagé avec le canvas principal.

Deux scénarios visuels supplémentaires couvrent un raccourci sautant une jonction
et un losange de jonctions. Les propriétés testent des chaînes jusqu’à 20 jonctions,
les tailles inégales, l’indépendance des calculs, les passages de rangées, l’alignement
des composantes et les coupures de chaînes jusqu’à 40 jonctions.

Le harnais utilisait des clés d’ordre invalides au-delà de huit jonctions. Il utilise
désormais le générateur de clés du projet. Les propriétés de dimensionnement
contrôlent le maximum du contenu et des quais pour les jonctions comme pour les nœuds.

Le contrôle incrémental a révélé un dépassement à 10,510 ms au 95ᵉ percentile pour
un budget de 10 ms. Le profilage a motivé une mesure des rails en un seul parcours
et un retour immédiat quand toutes les relations sont droites, donc sans inversion
transversale possible. Le budget passe ensuite à 9,761 ms, sans changement de seuil.

### Vérification de l’implémentation initiale

- Scénarios visuels : **650/650 passent**, dont les 624 cas initiaux et 26 cas
  supplémentaires pour le raccourci et le losange.
- Parcours navigateur dédiés : **12/12 passent**, y compris les dimensions réelles
  du symbole, les quais et l’inspection dans les quatre directions.
- `quality:fast` passe : 2 089 tests web et 34 tests de collaboration, couverture des
  branches web à 98,06 %, contrôles de lint, dépendances, code inutilisé et duplication.
- Performance du calcul complet : **60/60 cas passent**, dont les cinq tailles de
  `junction-heavy` jusqu’à 1 000 nœuds ; médiane de 7,764 ms pour un budget de 100 ms
  sur cette machine.
- Performance incrémentale ciblée sur `junction-heavy` : les cinq tranches passent,
  avec un total au 95ᵉ percentile de 9,761 ms pour le budget de 10 ms entre 100 et
  999 insertions. Les autres scénarios incrémentaux ne font pas partie de cette mesure.
- `pnpm check` passe intégralement : formatage, types, `quality:fast`, **140/140
  parcours navigateur** et builds web/collaboration (déploiement simulé).

Un lancement intermédiaire du navigateur a expiré pendant un rechargement de page,
coïncidant avec une modification de ces notes. Le parcours concerné passe trois fois
isolément, puis avec la suite complète lorsque les fichiers restent stables.

Les commandes de validation utilisent les versions de `mise.toml` :

```sh
mise exec -- pnpm test:web tests/scenarios/visual/scenarios.test.ts
mise exec -- pnpm check
mise exec -- pnpm test:performance
mise exec -- pnpm test:incremental-performance -t junction-heavy
```

### Limites explicites

Le biais existant aligne les boîtes dans leurs bandes ; ce lot n’ajoute pas un nouvel
ordonnancement des rangées selon le biais. Les attaches de groupes et les sauts de
rangs des graphes sans jonction conservent leur traitement existant. Les passages
extérieurs privilégient une géométrie valide et déterministe ; leur largeur et leur
nombre de coudes ne sont pas optimisés globalement.

Un essai exploratoire reliant un groupe peuplé à une jonction extérieure a révélé
un chevauchement possible entre l’enveloppe du groupe et la jonction. Les scénarios
fournis excluent explicitement les règles propres aux groupes : ce cas reste à
spécifier et corriger dans cette extension distincte, plutôt que d’introduire une
exception dans le placement des jonctions.

### Révision : fusion des entrées d’une même jonction

La revue visuelle demande de réduire les ponts dans le motif à deux jonctions,
trois entrées et deux sorties. L’allocation précédente réservait trois quais et
plusieurs traverses pour chaque jonction : 10 ponts au total, dont 9 dans le
couloir entrant, avec des symboles de 40 × 16.

Le quai entrant central est maintenant partagé. Dans le dernier couloir avant
la jonction, ses traverses d’arrivée fusionnent sur un même rail couvrant leur
enveloppe. Les dix relations documentaires restent distinctes et conservent leurs
identifiants. Les traverses de jonctions différentes restent séparées. Les
colonnes de départ coïncidant avec des arrivées sont libérées avant de rejoindre
les traverses, afin que la fusion ne crée pas de cycle de contraintes.

Résultat sur ce motif : **4 ponts au total, dont 3 du côté entrant** ; les symboles
mesurent **16 × 16**. La règle des quais exclusifs après croisement est conservée
pour les nœuds ordinaires. Les liens longs ne fusionnent que dans leur dernier
couloir avant la jonction, pas dans leurs passages intermédiaires.

Le scénario exécutable vérifie les quatre ponts, un quai par face, le partage
continu permis, les obstacles et les directions. Des propriétés couvrent aussi
les arrivées alignées, les conflits de colonnes créés par la fusion et l’ordre
des relations ; l’inspection et le parcours navigateur contrôlent les dimensions
et les quais réellement utilisés.

Validation de cette révision : **650/650 cas visuels**, 2 093 tests web et 34 tests
de collaboration passent. La couverture des branches web est de **98,09 %**.
Les quatre propriétés de jonctions et de traverses passent aussi avec **5 000
essais chacune**. `pnpm check` passe intégralement, avec **140/140 parcours
navigateur**, le build web et le déploiement simulé du worker de collaboration.
La capture du moteur réel confirme dix relations, quatre croisements physiques
et un canevas de 440 × 360, contre 440 × 384 avant la fusion.

### Révision : sorties alignées et marge du libellé

Le principe des entrées communes est conservé. La revue suivante demande que les
sorties de J2 vers A et B empruntent la même traverse et que le texte respire dans
le symbole. La mesure par défaut devient **28 × 20**, avec un texte inchangé de
6,5 px et environ 6 px de marge, dans l’application comme dans les scénarios.

Le canal regroupe maintenant les départs par jonction et évalue leurs fusions.
Il conserve celles qui n’ajoutent aucun croisement physique, ni de rails à nombre
de croisements égal. Fusionner aussi J1 ajoutait un cinquième pont : cette fusion
est écartée. Les sorties de J2 partagent un rail, les sorties de J1 gardent deux
rails, et le total reste à **quatre ponts**. Les traverses entrantes sont conservées.

La fusion remappe les contraintes des segments absorbés. Les détours issus d’une
même source partagent leur départ pour éviter une séparation suivie d’un
recouvrement ultérieur. Une traverse entrante déjà commune à plusieurs sources
ne peut pas fusionner leurs départs étrangers. Les essais couvrent les deux
faces partagées simultanément, les colonnes coïncidentes et l’ordre des relations.
La comparaison des croisements est locale au canal ; cette sélection déterministe
ne prétend pas minimiser globalement le nombre de ponts.

Validation de cette révision : **650/650 cas visuels**, **2 096 tests web** et
**34 tests de collaboration** passent ; la couverture des branches web atteint
**98,06 %**. Les propriétés des chaînes et des familles entrantes/sortantes ont
également été éprouvées avec **5 000 essais chacune**. `pnpm check` passe, dont
**140/140 parcours navigateur**, le contrôle des marges réelles du texte dans les
quatre directions, les builds web et le déploiement simulé du worker.

### Décision : même quai de sortie, traverse commune

La revue suivante précise que la préférence doit aussi s’appliquer aux sorties
de XOR 1. **Les flèches qui partent d’un même quai recherchent une traverse
commune**, pour un nœud comme pour une jonction. Le seul ajout d’un pont n’est
plus un motif de refus. Les obstacles, les quais distincts et la séparation des
réseaux étrangers restent des contraintes à respecter.

Le moteur fusionne les départs compatibles avant la coloration des rails et
supprime la comparaison successive des fusions par nombre de croisements.
Les familles sont identifiées par l’extrémité et le décalage réel du quai,
indépendamment de sa nature. Les deux sorties de J1 partagent maintenant un rail,
comme les deux sorties de J2. Le scénario comporte **cinq ponts**, dont trois
au-dessous des jonctions ; leurs ovales de 28 × 20 et les dix relations sont conservés.

Le scénario vérifie séparément le rail unique sortant de J1 et de J2. Les
propriétés vérifient le premier rail commun des branches sortantes, la progression
des détours, l’absence de partages étrangers et la stabilité sous permutation.
Un test distingue explicitement le même quai d’un nœud ordinaire, un autre quai
de ce nœud et un quai d’une autre extrémité.

Validation de cette décision : **650/650 cas visuels**, **2 097 tests web** et
**34 tests de collaboration** passent, avec **98,11 %** de couverture des branches
web. Les propriétés de jonctions et de familles de routes passent aussi avec
**5 000 essais chacune**. `pnpm check` passe intégralement : **140/140 parcours
navigateur**, builds web et déploiement simulé du worker compris. La capture du
scénario montre les deux traverses sortantes communes et les cinq ponts attendus.
