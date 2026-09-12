# Allocation des rails et des quais

Le moteur calcule les quais et les rails à partir du document, des rangs et des mesures du contenu. Ces réservations restent des données de layout : elles ne sont pas enregistrées dans le document et ne modifient pas l’ordre documentaire des nœuds.

## Calcul

1. Un premier placement identifie les couloirs entre rangées voisines de nœuds ordinaires. Les intervalles transversaux indépendants sont traités séparément. Les couloirs sans inversion gardent leurs quais centraux et leurs troncs partagés.
2. Les couloirs avec inversion reçoivent des quais distincts, ordonnés selon les extrémités opposées. Sur une face concernée, toutes les relations incidentes participent à la réservation, y compris celles qui sautent une rangée. Leur demande agrandit la dimension transversale des nœuds : maximum du contenu et du besoin de chaque face, jamais la somme des deux faces. Cette allocation est volontairement conservatrice : le partage en sortie reste autorisé par la spécification, mais n’est pas imposé dans un couloir croisé.
3. Le placement avec ces dimensions donne les positions transversales définitives. Les relations dont les deux quais sont alignés restent rectilignes.
4. Pour les autres relations, une contrainte interdit à une arrivée d’occuper une colonne avant que le départ correspondant ne l’ait quittée. Un cycle de contraintes est rompu par un trajet comportant deux segments transversaux, reliés par un segment sur l’axe principal. Il n’y a aucun retour en arrière.
5. Les contraintes sont parcourues dans l’ordre topologique. À chaque niveau, les segments disjoints réutilisent des rails par coloration d’intervalles. Les couloirs indépendants réutilisent leurs réservations ; les demandes d’un même intervalle de rangées se combinent par maximum. L’espace supplémentaire ne concerne que cet intervalle.
6. Le placement final utilise les espacements calculés, puis les chemins sont produits directement depuis le plan. Sans groupe ni jonction, cela se réduit à translater les rangées selon les espaces supplémentaires réservés. Les rails sont centrés entre les limites des rangées entières : des couloirs indépendants réutilisent les mêmes coordonnées même avec des tailles de boîtes différentes. Les enveloppes des groupes sont calculées avec les dimensions effectives des nœuds.

Le calcul de routage utilise des tris, des tables d’index et une file de priorité pour éviter une comparaison systématique de toutes les paires de relations. Les différentes phases réutilisent la préparation des composantes et leur ordre documentaire. Le résultat est déterministe et les entrées ne sont pas modifiées. Un recalcul après suppression repart du contenu mesuré et libère les réservations devenues inutiles.

## Géométrie et rendu

Les quais se trouvent uniquement sur les deux faces principales opposées. Les valeurs actuelles sont : quais espacés de 48, marge de 24 ; intervalle de base de 72, augmenté de 24 par rail supplémentaire. Le rail par défaut est recherché au centre ; sa position absolue n’est pas persistante.

Le partage est permis continûment au départ d’une même source. En entrée, une flèche impliquée dans un croisement conserve un tronc et un quai exclusifs, indépendamment du porteur du pont. Le rendu choisit un porteur disposant de suffisamment de place, en tenant compte des ponts déjà réservés : il ne supprime pas silencieusement un pont parce qu’un autre est trop proche.

Une rangée homogène de descendants se centre sur l’enveloppe de ses parents immédiats, plutôt que sur toute la composante. Cela conserve notamment D en face de B dans A → B/C, puis B → D (notation de succession).

## Périmètre et suites

L’allocateur de cette version concerne les relations entre nœuds ordinaires de rangs voisins. Les attaches de groupes, les jonctions explicites et les relations sautant des rangs conservent leur géométrie existante ; leur réservation autour des obstacles reste à étendre avec des scénarios dédiés.

Il n’ajoute pas de permutation automatique. L’hypothèse consistant à examiner une permutation dès que deux flèches contournent la même boîte doit encore être illustrée. La priorité convenue reste : contraintes documentaires et séparations, réduction des croisements, centrages, trajets droits, puis rails et coudes. La coloration actuelle garantit une solution déterministe, sans prétendre à un optimum global du nombre de rails ou de coudes.

Les scénarios visuels vérifient le pipeline réel dans les quatre directions et les biais compatibles. Les propriétés de routage couvrent aussi les graphes bipartis denses et les tailles inégales ; les tests de performance gardent leurs budgets existants.

## Inspecter les réservations dans l’atelier

Le réglage **Afficher les rails et les quais** superpose les quais entrants et sortants utilisés, les rails et l’intervalle entre rangées, ainsi que la dimension initiale du contenu. Le tableau détaille les besoins des deux faces et la dimension finale du nœud. Le contenu est représenté par un contour centré pour comparer les dimensions ; ce contour ne simule pas la position du texte.

Ces informations proviennent de l’option `inspectRouting` du moteur, activée par le harnais des scénarios. Elles sont absentes du calcul de production par défaut. Le réglage est mémorisé et ne change ni les coordonnées ni les assertions. Il s’applique également au dessin de référence d’un scénario comparatif.

L’inspection des rails concerne les liens entre nœuds de rangées voisines. Les corridors réservés sont distingués du routage par défaut, dont on observe les segments transversaux effectivement utilisés. Les repères ne prétendent pas exposer des identifiants persistants de rails ou de quais.
