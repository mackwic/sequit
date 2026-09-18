# Refonte du moteur de layout

## Statut

Cadre de décision au 17 septembre 2026. Cette note décrit la cible et les risques ; elle ne prétend pas que les IR, les lanes ou les régions sont déjà implémentées.

## Intention

Le moteur doit devenir une suite de calculs explicites, déterministes et inspectables afin de pouvoir :

- exprimer séparément contraintes dures, préférences et objectifs ;
- mémoriser les résultats dont les dépendances n’ont pas changé ;
- recalculer un sous-problème ou une région imbriquée et ses dépendances plutôt que tout le canvas lorsque c’est exact ;
- comparer systématiquement un calcul incrémental à un calcul froid ;
- contraindre un layout partagé par une ou plusieurs lanes, puis composer de vrais sous-layouts, notamment des cellules de grille ;
- expliquer pourquoi une solution a été retenue ou rejetée.

Le document structuré reste la source de vérité. Les IR sont des produits dérivés et immuables d’un instantané du document, de ses préférences de présentation et de ses mesures intrinsèques.

## Décisions acquises

- Une **région de layout** est une organisation visuelle virtuelle, pas un contenu du document ni une extrémité de relation.
- Le document possède au moins une région. Pour les anciens documents, une région racine normalisée peut être dérivée lors de la lecture.
- La définition des régions et lanes, leur politique et l’affectation des éléments sont des préférences de présentation persistées. Leurs coordonnées et dimensions sont dérivées.
- Un élément visuel appartient à une seule région.
- Un groupe visible et interactif appartient entièrement à une région et, si le layout comporte plusieurs lanes, à une seule lane. Tous ses descendants partagent ces affectations ; un groupe à cheval est invalide.
- Seules les relations peuvent franchir une frontière de région.
- Un layout a une lane implicite ou plusieurs lanes explicites. Une lane est une **contrainte d’affectation et de confinement dans le layout partagé**, pas une région enfant ni un sous-layout autonome. Son ordre est fixé dans le document ; sa taille est auto-extensible comme le canvas.
- Une cellule de grille est une région enfant organisée par les pistes de la grille et contient elle aussi un sous-layout.
- Une vraie région imbriquée reste **opaque pour les routes étrangères** : une relation dont aucune extrémité n’appartient à son sous-arbre ne traverse pas son intérieur. Une lane n’est pas opaque : les relations peuvent traverser l’espace libre d’une lane intermédiaire en évitant ses éléments et groupes.
- Une relation entre lanes non adjacentes est valide et doit être routable ; les gouttières et passages transversaux sont des ressources du layout commun, pas des ouvertures dans un sous-layout de lane.
- Chaque vraie région calcule ses propres rangs de layout. Une relation entre régions, notamment entre cellules, **n’impose aucune progression ni aucun rang partagé** à leurs contenus ; son trajet est composé par l’ancêtre commun.
- Le rang de layout est une décision **esthétique**, distincte de l’ordre des relations du document. Le moteur peut déplacer les rangs visuels et insérer des rangs vides pour ménager un passage, sans ajouter de nœud ni de relation au document.
- Une piste de grille dite fixe signifie un **minimum extensible** : elle grandit pour contenir un élément ou groupe indivisible.
- Un groupe replié peut exposer des attaches latérales dérivées de ses membres masqués, avec provenance et rang distincts ; les attaches ordinaires des autres éléments gardent leur règle actuelle.
- L’ordre visuel est d’abord dérivé. Une préférence documentaire explicite reste distincte de l’ordre effectivement choisi par le layout.
- Les ports, les portails de vraies régions, les rails/pistes et les routes sont d’abord dérivés, pas persistés. L’existence même d’un éventuel tunnel reste à décider par exemples.
- À entrées normalisées identiques, le résultat stabilisé d’un calcul incrémental doit être identique au calcul froid. Un hint issu de l’historique local ne peut pas orienter ce résultat stabilisé ; la géométrie précédente ne sert normalement qu’à la transition visuelle.
- En cas d’échec, ne jamais conserver le dernier layout valide comme vue stabilisée : la vue diagnostique doit être dérivée de l’état courant, sans dépendre de l’historique local d’un pair.
- Chaque région peut choisir une politique de layout, tout en respectant les invariants communs de confinement et de routage inter-régions.

## Position critique sur `Topology / Order / Shape / Metric`

L’intuition est bonne, mais ces quatre noms ne forment pas naturellement un pipeline linéaire pour Sequit.

Le cadre classique **Topology–Shape–Metrics** concerne d’abord le dessin orthogonal planaire : `topology` y désigne une embedding combinatoire, `shape` une représentation orthogonale sans coordonnées ni longueurs, et `metrics` l’affectation des coordonnées et longueurs. Ce n’est pas le même découpage que celui d’un layout hiérarchique. À l’inverse, ELK Layered sépare notamment l’affectation aux couches, la réduction des croisements, le placement des nœuds et le routage des arêtes.

Employer `TopologyIR` pour le simple graphe logique, ou `ShapeIR` pour un plan de routes, donnerait donc l’apparence d’un vocabulaire standard tout en changeant son sens. `Shape` est de plus déjà le terme ELK pour un élément rectangulaire muni d’une position et d’une taille.

Le découpage de travail le plus petit à éprouver est plutôt :

```text
document + préférences de présentation + mesures intrinsèques
                          │
                          v
              LayoutGraph (candidat)
              graphe adapté + appartenance aux régions/lanes
                          │
                          v
              LayeringIR (candidat)
              rangs locaux + domaines d’ordres admissibles
                          │
                          v
             LayoutContract (candidat)
             choix admissibles de ports, passages et ordres ;
             contraintes, objectifs et MetricDemand symboliques
                          │
                          v
              résolution déterministe
              choix discrets + dimensions compatibles
                          │
                          v
               matérialisation géométrique
               coordonnées + segments concrets
                          │
                          v
                    LayoutResult
```

Ce diagramme n’impose aucune classe de plus que nécessaire. Un contrat symbolique porte un **ensemble de solutions admissibles**, pas une route unique figée trop tôt. `MetricDemand` est un type de contrainte à l’intérieur de ce contrat, pas une IR supplémentaire. Le solveur peut essayer plusieurs affectations de façon bornée ; ce travail interne n’est pas un retour `GeometryIR → RoutingPlanIR` dans l’architecture publique. La matérialisation vérifie la solution choisie. Si elle échoue régulièrement, le contrat omet une contrainte et doit être corrigé.

Si le nom `RoutingPlanIR` est utile, il désigne la **vue routage du contrat** : domaines de faces, passages possibles et leurs demandes métriques, sans coordonnées ni choix irréversible. `GeometryIR` n’est pas tenue d’exister : le résultat du solveur peut être matérialisé directement en `LayoutResult`. C’est cette asymétrie qui coupe la dépendance retour.

Un cache seulement imaginable ne suffit pas : il faudra mesurer des hits sur des séquences d’édition réalistes, le coût de construction et de fingerprint de la frontière, et sa mémoire retenue. Si l’IR coûte plus que le calcul qu’elle évite, ou si son assertion se formule aussi bien sur le résultat voisin, on fusionne.

### Test d’existence des IR

| Frontière candidate     | Cache ou assertion qui pourrait la justifier                                                                                                                    | À fusionner si…                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `LayoutGraph`           | Cache du graphe et de l’appartenance aux régions ; assertions de confinement des groupes et d’identité des relations.                                           | Ce n’est qu’une copie de `LogicGraph` et de l’arbre de régions.                    |
| `LayeringIR`            | Cache indépendant des mesures lorsque les contraintes le permettent ; assertions sur précédences documentaires, rangs visuels locaux et ordre dans chaque rang. | Ses décisions dépendent toujours des métriques et ne se réutilisent jamais seules. |
| `LayoutContract`        | Assertions sur domaines de ports, alternatives de passage, demandes métriques, objectifs et opacité des vraies régions.                                         | Il ne décrit qu’une route déjà choisie ou duplique les inputs du solveur.          |
| `GeometryIR` (éventuel) | Cache ou assertion indépendante sur la solution métrique avant matérialisation.                                                                                 | Il ne fait que renommer les coordonnées et les segments du `LayoutResult`.         |

Les mesures intrinsèques sont d’abord un **input typé**, pas nécessairement une IR. La hiérarchie normalisée des régions peut rester une vue du graphe de layout. Les objets auxiliaires du graphe doivent conserver une provenance stable vers les identités documentaires, sans exiger une `LogicalTopologyIR` supplémentaire. Les sections et points de coude finaux peuvent rester dans `LayoutResult`, sans `RouteGeometryIR`. On ne scinde une frontière que lorsqu’un cache ou une assertion indépendante en démontre le besoin. Le nom `LayoutGraph` évite de faire passer le graphe hiérarchique pour la topologie planaire du cadre TSM.

`OrderIR` serait trop large : affectation à une couche, ordre dans la couche, ordre des ports et packing des composantes ont des dépendances différentes. `MetricIR` serait également trop large s’il mélangeait mesures intrinsèques et dimensions allouées après réservation des ports. Le contrat doit être assez puissant pour exprimer les choix couplés ; il faut néanmoins éviter d’en faire un solveur généraliste si des familles de contraintes spécialisées suffisent.

## Couplage routage–géométrie sans retour entre passes

Le moteur actuel montre le couplage réel : les ports peuvent agrandir une boîte, le replacement modifie les corridors disponibles, puis une proposition d’alignement peut être validée ou rejetée après un nouveau routage. Cela ne prouve pas qu’une boucle entre IR soit nécessaire ; cela prouve qu’un plan de route unique, choisi avant les dimensions, est trop pauvre.

La nouvelle frontière devrait représenter ensemble les possibilités compatibles :

```text
alternatives symboliques de faces, passages et ordre
+ demandes métriques (ports, largeur, dégagement, capacité)
+ contraintes dures et objectifs
→ choix conjoint déterministe, borné et justifié
→ coordonnées et segments concrets
```

Le témoin du solveur indique la branche choisie et les alternatives rejetées avec leur raison. Une passe ne mute pas une IR précédente. Le nombre de branches explorées et les tie-breaks sont définis ; en cas d’échec, on produit un diagnostic, pas une réparation géométrique implicite. La question d’implémentation est de savoir si cette résolution est un seul solveur local ou quelques sous-solveurs spécialisés avec contrat commun ; l’IR ne doit pas masquer un point fixe non borné.

## Boîtes larges et canvas infini

Sur la région racine auto-extensible, une boîte large ne rend normalement pas le layout infaisable : un passage extérieur peut être déplacé plus loin. L’espace infini résout la **faisabilité géométrique externe**, mais pas automatiquement la localité, la compacité ou la stabilité du résultat.

Déplacer un corridor peut encore :

- agrandir la région et déplacer ses régions sœurs ;
- déplacer le packing d’une composante entière ;
- changer le meilleur ordre ou le meilleur côté de port ;
- allonger toutes les arêtes d’un bundle ;
- invalider une route qui devait rester dans le plus petit ancêtre commun.

Une modification de taille ne devrait donc pas toujours invalider la structure d’une route. Le contrat peut garder l’alternative symbolique « passage extérieur, côté transverse positif, dans telle région ancêtre » avec ses besoins de dégagement ; la résolution alloue ensuite une coordonnée libre. Si le plan stocke déjà un corridor exact, la même modification invalide le routage.

Il faut aussi distinguer deux problèmes : contourner une boîte large et placer beaucoup de ports avec un dégagement minimal sur une même face. Le premier peut généralement déplacer le passage ; le second peut légitimement demander une dimension de boîte plus grande.

## Composition des régions et routage inter-régions

### Invariant d’opacité

Une vraie région enfant est un obstacle opaque pour une route étrangère, et un canvas autonome pour son propre contenu. Une route est étrangère à B si aucune de ses extrémités n’appartient au **sous-arbre** de B. Si une relation A → C est étrangère à B, elle ne traverse pas l’intérieur de B, même s’il paraît vide. Elle contourne B dans l’espace possédé par son ancêtre. Sans cette règle, B devrait réserver des couloirs décidés implicitement pendant le routage de son ancêtre ; la composition et le cache par région perdraient leur sens.

Une région enfant peut calculer son layout local sans connaître sa **translation finale** dans le canvas parent. Cette propriété ne suffit pas à garantir une indépendance totale : les arêtes incidentes à ses éléments imposent des besoins aux frontières. Le cache local dépend donc d’un **contrat normalisé** (connexions incidentes, côtés ou plages admissibles, capacité et dégagement), mais jamais des coordonnées absolues des régions sœurs ni du tracé particulier d’une route étrangère. L’enfant publie son empreinte et les possibilités de connexion ; le parent les compose sans pénétrer son intérieur. Un changement du contrat invalide l’enfant explicitement.

Une lane n’est **pas** cette région enfant. Le layout partagé calcule ensemble les rangs, l’ordre, les dimensions et le routage de toutes ses lanes. Les tâches sont confinées à leur lane ; une relation peut franchir une lane intermédiaire dans son espace libre. Cette distinction supprime le contrat artificiel de « passage parental retiré » à la lane et la promesse prématurée d’un cache par lane. L’orientation des lanes peut être parallèle ou transverse à la progression, mais leur ordre documentaire est fixe et leur étendue grandit à la demande.

Entre deux vraies régions, en revanche, il n’existe **ni axe de progression commun ni correspondance de rangs**. Par exemple, une relation entre un élément au rang visuel 4 d’une cellule et un élément au rang visuel 1 d’une autre est valide sans déplacer l’un des deux. Chaque cellule résout ses rangs localement ; l’ancêtre commun route la relation entre leurs frontières. Les contraintes de précédence du document restent distinctes de ces choix de rangs esthétiques.

Une relation inter-régions est décomposée par le plus petit ancêtre commun :

```text
port de l’extrémité locale
→ portail dérivé sur la frontière de la région
→ route dans la région ancêtre commune
→ portail de la région cible
→ port de l’extrémité locale
```

Un portail est un artefact de calcul, pas nécessairement un point visible sur la cellule. Il termine une connexion **incidente** à la région ; il n’autorise pas une relation étrangère à traverser son intérieur. Chaque segment de route a une région propriétaire ; un contact avec une frontière d’enfant est permis uniquement à un portail déclaré, pas à un point arbitraire. Le parent arbitre les corridors et l’esthétique entre régions, dans l’espace qu’il possède. Si plusieurs relations partagent un portail, on privilégie la lisibilité plutôt qu’une réduction aveugle du nombre de points.

### Cas séparateur de lanes : A | B | C

Si B est une lane infinie qui sépare A de C dans le plan, les gouttières situées seulement **entre** les lanes ne relient pas les deux côtés de B. Une relation A → C est pourtant ordinaire et **doit être routable** : interdire une relation qui saute B est rejeté. Le layout commun peut réserver un passage transversal dans l’espace libre de B, raccorder les gouttières de part et d’autre, puis réordonner les éléments dans les rangs ou agrandir les espacements pour préserver ce passage. B n’est ni un obstacle opaque ni un sous-layout à percer.

Les gouttières longitudinales et les passages transversaux forment un réseau commun, comparable à un bus avec ses intersections. Le contrat symbolique doit exprimer leur continuité, leur capacité, les obstacles et le dégagement. On privilégie un chemin lisible et monotone si possible. Pour dégager un passage, le moteur peut changer l’ordre des éléments dans un rang, déplacer leur rang **visuel**, insérer un rang vide et agrandir les espacements. Cela ne change ni les relations ni leurs précédences documentaires. La numérotation par plus long chemin décrite aujourd’hui dans `docs/design.md` reste le comportement courant, pas une limite imposée à la cible de cette refonte.

Si aucun passage continu lisible ne se dégage malgré ces libertés, faut-il introduire un tunnel visuellement discontinu, ou chercher une autre solution ? Sa nécessité, sa forme et son statut dans les contraintes restent ouverts. Aucun tunnel n’est donc requis par le modèle à ce stade.

**Scénario métier témoin :** lanes `S | SD | C` (sales, service delivery, customer). C demande un devis à S ; S accuse réception et étudie faisabilité et montants ; SD décide GO/NOGO ; en NOGO, S répond à C et le processus s’arrête ; en GO, S prépare et envoie le devis à C, C signe l’intention, SD propose livrables et calendrier, C signe le calendrier, SD fournit le service puis signale à S les changements intervenus depuis la demande. Les messages explicites C → S et S → C traversent l’espace de SD sans toucher ses tâches ni ses groupes ; les échanges SD ↔ S et SD ↔ C sont adjacents. La destination des signatures reste à préciser plutôt que d’inventer une relation. Ce scénario doit être routable dans les deux orientations de lanes et servir de témoin de capacité, partage de bus et invalidation globale du layout.

Une lane n’est pas une région ELK indépendante. Une `partition` ELK pourrait aider à son affectation, sans garantir à elle seule le confinement, les passages transversaux ou les groupes indivisibles. Les vraies régions imbriquées, notamment les cellules, restent un problème de composition distinct.

## Contraintes et objectifs

Les contraintes dures éliminent une solution. Les objectifs classent les solutions encore valides. Le classement doit être lexicographique avec un tie-break canonique, pas une somme de poids difficile à interpréter.

### Socle de contraintes dures proposé

1. Document et graphe de layout valides.
2. Un élément appartient à une région et, dans un layout multi-lanes, à une lane ; un groupe et tous ses descendants restent dans la même région et la même lane.
3. Aucun élément ni groupe ne déborde de sa région ou de sa lane après croissance, ni ne chevauche une gouttière ou un passage réservé. Un groupe reste indivisible.
4. Une relation ne traverse pas une boîte étrangère et respecte les dégagements.
5. Les ports utilisent des faces autorisées et les routes respectent leur style géométrique.
6. Une relation inter-régions traverse les frontières selon la hiérarchie des régions et ne pénètre jamais dans l’intérieur d’une vraie région étrangère.
7. L’ordre documentaire des lanes est fixe. Toute relation entre lanes non adjacentes dispose d’un chemin dans le layout commun, via des gouttières et passages qui évitent les boîtes et groupes de la lane intermédiaire.
8. Une relation inter-régions n’impose ni rang global, ni progression, ni alignement des rangs locaux de ses régions extrémités.

### Exemples à utiliser pour arrêter l’ordre des objectifs

1. **Ordre ou croisements.** Garder l’ordre documentaire produit deux croisements ; permuter deux boîtes les supprime mais déplace une branche. Proposition : ordre documentaire souple, puis réduction des croisements, sauf préférence d’ordre explicitement verrouillée.
2. **Bus existant ou nouveau passage.** Plusieurs relations C ↔ S peuvent partager un passage déjà réservé à travers SD au prix d’un détour, ou justifier un autre passage qui réorganise les éléments de SD. Il faut classer lisibilité, longueur et capacité dans le layout commun.
3. **Partage ou pont.** Deux arêtes issues du même port peuvent partager un chemin, mais ce partage ajoute un pont avec une troisième arête. La politique actuelle préfère le partage ; ce cas doit confirmer si cette préférence reste supérieure au nombre de ponts.
4. **Stabilité ou compacité.** Après suppression d’un élément, garder un trou préserve les positions ; recompacter réduit l’aire mais déplace tout le voisinage. Sans géométrie précédente comme input, le calcul froid doit recompacter canoniquement.
5. **Port central ou taille.** Partager un port central garde la boîte compacte mais peut produire un bundle dense ; distribuer plusieurs ports améliore la lisibilité mais peut agrandir la boîte.
6. **Ordre des lanes ou route courte.** Inverser deux lanes raccourcirait plusieurs relations, mais l’ordre fixé par l’utilisateur prime ; l’ordre des boîtes, leurs rangs visuels et les espacements restent ajustables.
7. **Route continue ou tunnel hypothétique.** Un groupe bloque les passages envisagés : comparer réordonnancement, rang vide, croissance et détour lisible ; examiner ensuite si un tunnel apporterait quelque chose, sans le présupposer.

Une première hiérarchie à éprouver est : validité et confinement, évitement des obstacles, ordre fixé des lanes et des préférences verrouillées, **lisibilité des chemins et des attaches**, réduction des croisements, continuité des chemins partagés, réduction des détours et coudes, puis aire. La place d’un éventuel tunnel dans cette hiérarchie n’est pas décidée. La continuité par rapport à une image précédente non partagée relève de l’animation, pas de cet ordre d’optimisation du résultat stabilisé.

## Faisabilité et diagnostics

Avec une racine et des lanes auto-extensibles, les boîtes larges, les relations longues et l’ajout de pistes de routage ne sont pas des erreurs d’infaisabilité. Les contradictions apparaissent lorsqu’une borne ou une règle structurelle est explicite, par exemple :

- un groupe ou deux de ses descendants sont affectés à des régions différentes ;
- un groupe et ses descendants sont affectés à des lanes différentes ;
- des contraintes imposent simultanément `A avant B` et `B avant A` ;
- toutes les faces d’un port sont interdites alors qu’une relation doit sortir ;
- deux contraintes documentaires imposent des affectations de lane ou des positions incompatibles ;
- deux régions doivent être disjointes tout en ayant des bornes fixes qui se chevauchent.

Une impossibilité doit produire un diagnostic structuré avec la contrainte, les éléments concernés, la région et les tentatives de dégradation autorisées. Elle ne doit jamais être résolue en laissant silencieusement déborder un groupe.

La **vue stabilisée** ne conserve pas le dernier layout valide. Un tel fallback rendrait l’affichage dépendant de l’historique local : deux pairs ayant le même document et les mêmes mesures pourraient voir deux dessins différents. La cible est une vue partielle diagnostique calculée depuis l’état courant, par exemple les régions encore valides et un emplacement d’erreur déterministe pour celle qui échoue. Une ancienne géométrie peut servir uniquement d’image de départ éphémère à une animation, jamais de résultat final ou de fallback silencieux. Le comportement actuel qui redéplie de façon déterministe une projection de groupe créant un faux cycle doit être réexaminé séparément : il ne réutilise pas le dernier layout, mais ce n’est pas encore la vue diagnostique visée. Le contrat de projection actuel conserve effectivement la scène précédente lors de certains snapshots invalides ; sa migration et celle des tests associés sont donc un travail explicite, non un simple réglage du routeur.

## Mémoïsation et incrémentalité

Un cache par nom de passe ne suffit pas. Chaque artefact doit déclarer son empreinte d’entrée et ses dépendances :

- version du schéma de l’IR et de l’algorithme ;
- identités et relations locales dans un ordre canonique ;
- hiérarchie/politique de région et affectation/ordre/politique de croissance des lanes ;
- contraintes de rang visuel et d’ordre partagées **seulement dans un même layout multi-lanes**, jamais entre deux vraies régions ;
- mesures intrinsèques concernées ;
- contrat de frontière normalisé des connexions incidentes ;
- empreinte des obstacles, gouttières et passages du layout partagé ;
- empreinte des régions enfant opaques et corridors de l’ancêtre commun pour le routage inter-régions ;
- options de layout et tie-breaks.

Le futur fingerprint doit normaliser l’ordre des collections avant sérialisation. La signature de topologie actuelle suit encore l’ordre brut des tableaux : le moteur peut donner le même layout sous permutation tout en manquant son cache.

| Modification                            | Recalcul minimal attendu                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Couleur ou style de rendu sans métrique | Aucun calcul de layout                                                                                                 |
| Texte changeant la taille               | Métriques intrinsèques locales, puis géométrie et routes réellement affectées                                          |
| Relation ajoutée                        | Graphe, contraintes de rang/ordre et solution du layout partagé ; invalidation plus locale seulement si prouvée        |
| Groupe déplacé entre régions            | Validation d’appartenance, deux sous-layouts, ancêtres communs et relations traversantes                               |
| Translation d’une région inchangée      | Transformation parentale et route inter-régions, sans refaire son sous-layout                                          |
| Politique d’une région                  | Cette région, son empreinte publiée, ses ancêtres et les routes qui la traversent                                      |
| Relation étrangère à une vraie région B | Routage de l’ancêtre concerné ; intérieur de B réutilisable si son contrat incident et son empreinte restent inchangés |
| Relation traversant une lane B          | Recalcul potentiellement global du layout partagé ; aucun cache local à B promis                                       |
| Pli ou dépli d’un groupe                | Projection visible, région propriétaire, ancêtres et relations touchées ; animation séparée du résultat stabilisé      |

L’incrémentalité est une optimisation, pas une nouvelle sémantique. Pour un même ensemble d’inputs explicites :

```text
incremental(previousDocument, changes, normalizedInputs)
  === cold(updatedDocument, normalizedInputs)
```

### Déterminisme sans arithmétique exacte imposée

Le besoin est que deux chemins de calcul produisent le même `LayoutResult` stabilisé pour le **même document, les mêmes préférences, les mêmes mesures normalisées et la même version d’algorithme**. Il ne requiert ni rationnels, ni expressions symboliques pour chaque coordonnée. Une implémentation en flottants peut suffire si elle normalise l’ordre des entrées, fixe l’ordre des opérations et tous les tie-breaks, et fait emprunter au calcul incrémental les mêmes décisions sémantiques qu’au calcul froid. Les tests doivent comparer le résultat observable, pas défendre une représentation interne.

L’arrondi au demi-pixel inférieur n’est pas une règle générale du modèle. Arrondir **vers le bas une taille occupée** peut faire chevaucher une boîte, un port ou un dégagement ; si une quantification devient nécessaire, elle doit être conservatrice selon la grandeur (taille occupée vers le haut, espace disponible vers le bas) et vérifiée sur les mesures DOM et le rendu. La quantification uniforme et le calcul exact ne sont pas des préconditions de la refonte. Deux navigateurs peuvent de toute façon fournir des mesures de police différentes ; la convergence entre pairs ne peut être exigée qu’à inputs métriques égaux ou avec une politique de normalisation explicitement partagée.

Un éventuel `StabilityHint` versionné ne suffit pas, à lui seul, à garantir la convergence entre pairs : s’il vient de leur dernier dessin local, leurs hints peuvent différer malgré un document courant identique. Pour le résultat stabilisé, il ne serait admissible que s’il est dérivé canoniquement des mêmes inputs partagés ; sinon il reste un indice de transition éphémère, sans effet sur le solveur final. Le cache ne choisit jamais implicitement une solution différente du calcul froid.

Le cache doit rester borné et appartenir à la projection d’un document. Le cœur du moteur garde un `LayoutWorkspace` par appel et aucun état mutable inter-appels.

## Pli/dépli et continuité perceptive

Le pli/dépli n’est pas seulement une comparaison de deux layouts corrects. C’est une transition entre deux projections visibles du même document. L’état ouvert/fermé du groupe appartient déjà au document ; la projection actuelle conserve la provenance des relations agrégées et les identifiants des éléments masqués.

Le résultat stabilisé après l’opération doit dépendre du document courant, des préférences de présentation et des mesures normalisées. L’animation peut utiliser la géométrie affichée juste avant l’opération comme **état de départ éphémère**, sans devenir un input caché du layout final. Deux pairs peuvent voir des transitions différentes pendant quelques centaines de millisecondes, mais doivent converger vers le même dessin stabilisé à inputs égaux.

Règles de transition à spécifier et vérifier :

- les membres visibles se déplacent vers l’empreinte du groupe replié, sans disparition brusque à une position étrangère ;
- les relations incidentes se raccordent progressivement aux ports dérivés du groupe, y compris les attaches latérales nécessaires ; les relations internes masquées ne laissent ni segment ni pont fantôme ;
- au dépli, les identifiants et la provenance permettent de rattacher les éléments et les relations à leur destination ;
- les vraies régions étrangères ne sont pas recalculées intérieurement si leur contrat est inchangé ; une lane voisine peut bouger, car elle partage le layout ;
- l’animation peut être interrompue par une nouvelle opération, une mise à jour collaborative ou une préférence de mouvement réduit, sans altérer le résultat final ;
- la caméra garde **l’objet cliqué près du curseur** pendant la transition, y compris lorsque le canvas s’étend ou se compacte ; si cet objet devient masqué, son enveloppe de groupe visible sert de cible.

Les assertions de projection et de géométrie appartiennent au pipeline réel ; la continuité temporelle relève des E2E ou d’un harnais de transition dédié, pas d’un faux scénario statique de l’atelier visuel.

### Cas témoin avant de figer la projection : `B → x → A`, `G = {A, B}`

Le document source est acyclique, mais la projection actuelle d’un G replié remplace A et B par le même sommet et crée `G → x → G`. La vue revient alors à l’état déplié avec un avertissement. La cible est de garder les contraintes de rang et la provenance des membres masqués : G reste visible comme une seule enveloppe couvrant les trois rangs, tandis que A et B restent deux ancrages logiques distincts.

Cette conservation évite le faux cycle **de classement**, pas automatiquement le conflit **de routage**. Pour `B → x → A`, le groupe replié emploie des **attaches latérales dérivées**, liées par provenance aux deux membres masqués. C’est une exception ciblée aux faces ordinaires, non une permission générale d’attacher latéralement toutes les boîtes. Le témoin plus dense `G = {A, B, C, D}`, `D → x → B` et `C → y → B` vérifie que x et y restent visuellement dans les rangs de G et que les attaches restent lisibles. Les dessins de l’atelier doivent montrer ouvert/replié et les deux orientations avant l’étape de projection ; ne pas masquer un échec derrière un `catch` général. La règle actuelle de faces principales dans `docs/design.md` devra être amendée au moment de l’implémentation, pas anticipée ici comme si le moteur la respectait déjà.

## Plan de migration

### 0. Aligner le vocabulaire sans changer le comportement — en cours

- **Fait dans le checkout courant :** `quay` → `port` dans le noyau, l’inspection, l’atelier, les assertions et les scénarios ; `RoutingPortRole` (`incoming`/`outgoing`) distinct de la face géométrique ; `Port` distinct de `PortAnchor` dans le lexique.
- **Reste un audit de sens, pas un préalable à coder les IR :** `rail`, `corridor`, `row/rank/layer`, `relation/edge` et `junction`. Ces couples ne sont pas synonymes ; ne les renommer qu’après avoir nommé leur rôle exact et les usages à migrer.

### Préconditions des deux nouvelles capacités

- Avant les lanes multiples : figurer `A | B | C` et le processus `S | SD | C` dans l’atelier. Une relation entre lanes non adjacentes doit avoir un chemin dans le layout commun, éventuellement après changement des rangs visuels, insertion d’un rang vide et croissance des espacements.
- Avant les vraies régions imbriquées : définir le contrat de frontière, l’opacité étrangère, les portails incidents et la composition au plus petit ancêtre commun, sans progression ni rangs partagés entre régions.
- Ne promettre ni cache indépendant par lane, ni cache intérieur de vraie région avant une mesure de hits et une preuve d’invalidation correcte.

### 1. Prouver les frontières nécessaires sur le pipeline actuel

- Inventorier une assertion ou un cache indépendant pour chaque IR candidate ; fusionner les autres avec les données ou résultats existants.
- Commencer par une vue immuable du graphe et un contrat de contraintes symboliques seulement si les tests d’existence ci-dessus sont satisfaits.
- Garder les algorithmes et le `LayoutResult` observables inchangés.
- Ajouter un comparateur différentiel entre ancien chemin et chemin enveloppé.

### 2. Séparer mesures, contraintes et matérialisation

- Faire produire aux allocations de ports et de routage des `MetricDemand` explicites à l’intérieur d’un contrat contenant aussi les alternatives de passage et les choix discrets.
- Résoudre ces contraintes de manière bornée et déterministe avant de matérialiser les coordonnées ; supprimer le feedback entre artefacts de passes.
- Supprimer les mutations transversales qui ne sont pas possédées par le workspace de l’appel.

### 3. Introduire une région racine unique

- Normaliser tous les documents existants vers une région racine.
- Exécuter le moteur actuel comme politique de cette région.
- Prouver l’équivalence différentielle avant d’ajouter une seconde région.
- Vérifier le pli/dépli existant sur la projection visible avant de figer le contrat de frontière.

### 4. Ajouter plusieurs lanes au layout partagé

- Persister affectation, ordre fixe, orientation et croissance auto-extensible des lanes.
- Calculer les rangs, l’ordre, la géométrie et les routes des lanes ensemble ; réserver des gouttières et passages dans l’espace libre des lanes intermédiaires.
- Commencer par deux lanes, puis trois avec une relation qui franchit la lane intermédiaire, puis les deux orientations et le processus `S | SD | C`.
- Réordonner les éléments dans les rangs, déplacer les rangs visuels ou en insérer un vide et élargir les passages pour éviter de couper les groupes ; éprouver les cas où cela ne suffit pas.

### 5. Composer les vraies régions, puis la grille

- Ajouter une vue normalisée des régions, des coordonnées locales et des transformations parentales, sans créer automatiquement une IR supplémentaire.
- Implémenter l’opacité des vraies régions, les contrats de frontière et le routage au plus petit ancêtre commun.
- Vérifier qu’une relation entre cellules relie deux layouts locaux indépendants sans aligner leurs rangs ni leur imposer un sens de progression.
- Ajouter les cellules de grille comme sous-layouts ; leurs pistes ont des minima extensibles, pas une borne qui ferait déborder un groupe.
- Vérifier systématiquement le confinement des groupes et de leurs descendants.

### 6. Ajouter les caches fins

- Commencer par les frontières structurelles et métriques intrinsèques qui montrent un gain réel.
- Ajouter le cache par vraie région seulement après stabilisation des contrats incidents ; ne pas promettre de cache par lane.
- Comparer chaque chemin incrémental à un recalcul froid dans les tests de propriétés.
- Mesurer séparément temps, mémoire, taux de réutilisation et coût d’invalidation des ancêtres.

## Vérification attendue à chaque étape

- Tests différentiels du `LayoutResult` sur le corpus visuel existant.
- Propriétés sur déterminisme, immuabilité, permutations d’entrée et équivalence incrémental/froid.
- Contre-exemples injectés pour chaque contrainte dure et chaque diagnostic.
- Scénarios réels pour groupes imbriqués, relations longues, jonctions, lanes parallèles/transverses et grilles.
- Tests de performance qui distinguent préparation froide, hit de cache, invalidation locale et invalidation remontant aux ancêtres.
- Aucun changement de qualité globale déclaré vert sans exécution fraîche des portes définies dans `package.json`.

## Cahier des règles visuelles et atelier

L’atelier possède déjà un catalogue déterministe de scénarios illustrés, couplés à des assertions du vrai pipeline. Il doit devenir le **cahier exécutable des règles**, avec pour chaque règle un identifiant stable, un statut (contrainte dure, préférence ou objectif), un témoin lisible, un contre-exemple et le niveau de vérification approprié. Une capture jugée « jolie » ne remplace pas l’assertion ; inversement, les compromis esthétiques demandent des paires de dessins comparables plutôt qu’un seul booléen.

| Priorité | Règle ou compromis à illustrer                                 | Vérification attendue                                                                                                                                                                   |
| -------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Vraie région B vide puis peuplée, étrangère à A → C            | Aucune portion de route A → C dans l’intérieur de B ; le contenu de B ne change pas cette interdiction.                                                                                 |
| P0       | Lanes séparatrices A \| B \| C                                 | Le layout commun alloue un passage continu dans l’espace libre de B et le raccorde aux gouttières ; aucune relation A → C n’est interdite.                                              |
| P0       | Processus `S \| SD \| C`                                       | Les messages C ↔ S traversent l’espace libre de SD via des passages du layout commun ; les tâches et groupes de SD restent confinés et aucun groupe n’est coupé.                        |
| P0       | Groupe de SD couvrant l’intervalle de rangs d’un message C → S | Chercher un passage monotone en réordonnant les éléments, en déplaçant les rangs visuels ou en insérant un rang vide ; illustrer séparément la question d’un éventuel tunnel.           |
| P0       | Relation entre régions imbriquées                              | Décomposition au plus petit ancêtre commun, raccords aux frontières, aucun débordement d’élément ou de groupe.                                                                          |
| P0       | Relation entre deux cellules : rang visuel 4 → rang visuel 1   | Les rangs restent locaux et non alignés ; aucune progression inter-cellule n’est ajoutée par la route.                                                                                  |
| P0       | Translation d’une région enfant                                | Même sous-layout en coordonnées locales et mêmes routes internes ; seules sa transformation et les routes parentales changent.                                                          |
| P0       | Échec d’une contrainte dure                                    | Vue partielle diagnostique dérivée de l’état courant ; aucun dernier layout valide conservé comme résultat stabilisé.                                                                   |
| P1       | Lanes parallèles et transverses, puis cellules                 | Ordre des lanes fixé, croissance auto-extensible, layout commun pour lanes ; vrai sous-layout local et minima extensibles pour cellules.                                                |
| P1       | Cellule initialement plus petite qu’un groupe                  | Sa piste grandit au minimum nécessaire ; aucun débordement ni échec artificiel.                                                                                                         |
| P1       | Pli/dépli avec relations traversantes                          | Projection, provenance, attaches latérales ciblées et identifiants exacts à froid ; caméra ancrée sur l’objet cliqué près du curseur, interruption et mouvement réduit vérifiés en E2E. |
| P1       | Modification locale et comparaison incrémental/froid           | Même résultat stabilisé à inputs normalisés identiques ; cache hit des vraies régions indépendantes seulement lorsque leur contrat est inchangé.                                        |
| P2       | Partage de portails, saturation de gouttière, ponts et détours | Paires d’exemples montrant le classement des objectifs et les cas où la capacité impose une croissance ou un diagnostic.                                                                |

Le catalogue manuel reste stable et relisible en revue. Les échecs aléatoires **réduits** rejoignent ce catalogue comme nouveaux scénarios nommés ; l’exécution aléatoire et le rejeu vivent dans un panneau ou un outil séparé. Il faut aussi noter pour chaque objectif esthétique un cas où le privilégier dégrade un autre objectif, afin de décider l’ordre lexicographique avec des dessins concrets.

## Générateur de cas et fuzzing

La base actuelle de tests de propriétés parcourt déjà le pipeline réel et couvre plusieurs invariants géométriques, permutations et changements d’échelle. Elle ne génère pas encore les arbres de régions ni les séquences d’éditions nécessaires pour éprouver la composition et les caches. Le générateur visé est **structuré**, pas une distribution uniforme de rectangles et d’arêtes :

1. Composer des motifs topologiques nommés (chaîne, diamant, éventail, relation longue, jonction, composantes indépendantes), des groupes, une affectation de lanes au sein d’un layout partagé et, séparément, un arbre de vraies régions.
2. Varier les orientations et affectations de lanes, notamment la bande séparatrice avec passage déjà disponible ou exigeant croissance/réordonnancement ; varier aussi les minima de cellules et générer des contraintes contradictoires ciblées pour les diagnostics.
3. Donner des mesures intrinsèques normalisées, notamment tailles très asymétriques, valeurs fractionnaires, ports saturés et bornes juste au-dessous/au-dessus du minimum.
4. Générer de courtes séquences d’éditions : nouvelle mesure, ajout/retrait de relation, déplacement entre lanes/régions, changement de politique, pli/dépli et réordonnancement documentaire de lanes.

Les oracles exécutent le **vrai pipeline**. Ils vérifient le confinement des lanes et régions, l’opacité des seules vraies régions, la continuité des passages entre lanes, la décomposition des routes inter-régions, l’indépendance des rangs entre cellules, les diagnostics et les invariants métamorphiques : permutation des collections, translation locale, absence de fuite entre appels, et `incremental === cold` à inputs normalisés identiques. Un oracle d’invalidation observe les frontières de cache des vraies régions : une relation étrangère à B ne recalcule pas son intérieur si son contrat incident et son empreinte restent inchangés. Aucune hypothèse de cette sorte ne s’applique à une lane. Les mesures de temps complètent cet oracle, elles ne le remplacent pas.

Chaque échec doit enregistrer le document, les préférences, les mesures, la séquence d’opérations, la version d’algorithme, les tags de motifs, la seed et le chemin de rejeu, puis être **réduit** en conservant autant que possible la propriété fautive et les identifiants. Le cas sérialisé est indispensable : une seed seule peut rejouer autre chose après évolution du générateur. La couverture se juge par motifs et combinaisons structurantes (par exemple `lane-séparatrice × relation-traversante × passage-à-allouer`), pas par nombre brut de tirages.

Première tranche exécutable sur le moteur actuel : enrichir les motifs du générateur mono-région, canoniser le rejeu des contre-exemples et vérifier les permutations de collections et les mesures fractionnaires. Concevoir séparément le générateur `A | B | C` de lanes partagées et le générateur de deux ou trois vraies régions avec oracle d’opacité ; les exécuter contre le vrai pipeline lors de chaque capacité correspondante. Les tests de continuité temporelle du pli/dépli restent E2E : un fuzzer de géométrie statique ne peut pas prouver une animation agréable.

## Questions restant à trancher par exemples

1. Quelle grammaire minimale de contraintes et d’alternatives suffit au routage sans transformer le moteur en solveur général ? Un premier prototype sur les ports saturés, `S | SD | C` et le groupe replié doit éprouver cette frontière.
2. Après réordonnancement, déplacement des rangs visuels, insertion de rangs vides et croissance du layout, existe-t-il un motif pour lequel un tunnel serait préférable à toute route continue ? Si oui seulement, quelle forme d’extrémités et quelles étiquettes seraient lisibles ?
3. Pour les vraies régions imbriquées, quel contrat incident minimal permet le layout local, les portails partagés lisibles et un cache sans dépendance aux routes étrangères ?

L’ordre fixe et l’auto-extension des lanes, les minima extensibles de grille, les attaches latérales ciblées du groupe replié, l’ancre de caméra près du curseur, la liberté d’insérer un rang visuel vide, l’absence de progression entre vraies régions, l’opacité des seules vraies régions et l’absence de fallback vers le dernier layout valide ne sont plus des questions ouvertes. L’existence même d’un tunnel, elle, reste interrogative. Les choix restants se jugent sur les exemples du cahier visuel avant de figer les contrats de résolution et de composition.
