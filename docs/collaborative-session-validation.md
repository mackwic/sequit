# Validation de la collaboration

Scénarios métier implémentés. Les tests utilisent les situations ci-dessous ;
Alice et Bob ont deux contextes navigateur indépendants connectés à la même room.

## Situations initiales

Fixtures fixes dans [collaborative-document.ts](../tests/support/fixtures/collaborative-document.ts) :

| Nom                     | État connu                                                           |
| ----------------------- | -------------------------------------------------------------------- |
| **Deux boîtes**         | Nœuds A et B, textes `Alpha` et `Bravo`, sans groupe ni relation.    |
| **Deux boîtes reliées** | Même document, avec R : `{ from: B, to: A }`.                        |
| **Groupe ouvert**       | Même document et relation R, avec A et B dans G, `state = expanded`. |

Dans les trois situations, A et B utilisent la nature N (`Action`, `#00aa44`),
sans surcharge de style. Le layout initial est `top-to-bottom`, biais `top`.

## Scénarios

| Given               | When                                            | Then                                                                                                                       |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deux boîtes         | Alice modifie le texte de A en `Alpha modifié`. | Bob voit `Alpha modifié`.                                                                                                  |
| Deux boîtes         | Alice crée la relation R de B vers A.           | Bob voit les boîtes reliées.                                                                                               |
| Deux boîtes reliées | Alice supprime B.                               | Bob voit disparaître B et R ; A reste.                                                                                     |
| Deux boîtes reliées | Alice crée une relation de A vers B.            | La connexion d’Alice est fermée, sa page recharge et affiche un toast d’erreur ; le document reste inchangé chez les deux. |
| Deux boîtes reliées | Alice regroupe A et B dans G.                   | Bob voit G contenant les deux boîtes ; R est conservée.                                                                    |
| Groupe ouvert       | Alice affecte `state = closed` à G.             | Bob voit le groupe fermé ; son contenu reste dans le document.                                                             |
| Groupe ouvert       | Alice dissout G.                                | Bob retrouve A et B sans groupe ; R est conservée.                                                                         |
| Deux boîtes reliées | Alice choisit `left-to-right`, biais `left`.    | Bob reçoit cette paire et voit la disposition recalculée.                                                                  |

## Une reprise après coupure

- **Given** : Deux boîtes, synchronisées chez Alice et Bob, puis leurs connexions
  sont coupées ; les pages restent ouvertes.
- **When** : Alice modifie A en `Alpha modifié`, Bob modifie B en `Bravo modifié`,
  puis ils se reconnectent.
- **Then** : tous deux retrouvent A = `Alpha modifié` et B = `Bravo modifié`.

## Regroupement des frappes

- **Given** : Deux boîtes.
- **When** : Alice tape dans A.
- **Then** : elle voit sa saisie immédiatement ; les updates partent après 50 ms
  de pause, ou après 500 ms maximum de saisie continue pour chaque lot. Bob voit
  les modifications reçues.

## Vérifications exécutables

Les [cinq tests navigateur](../tests/app/web/e2e/collaborative-session.spec.ts)
utilisent le vrai WebSocket et le Durable Object lancé localement par Wrangler.
Ils couvrent les scénarios ci-dessus, la coédition du même texte, la conservation
du curseur, le titre, le libellé d’une nature et une propriété de style.

Les tests ciblés du [buffer](../tests/lib/infrastructure/collaboration/text-update-buffer.test.ts)
vérifient les délais 50/500 ms avec une horloge contrôlée. Le
[binding textarea](../tests/app/web/document/shared-textarea.test.ts) vérifie
également la composition IME pendant une modification distante.

Les [tests du Worker](../tests/workers/collaboration-worker/room-proposals.test.ts)
exécutent la validation et la persistance réelles dans Workerd, notamment les
refus sans mutation, la reprise des commandes et le filtrage des updates
textuelles. Aucun déploiement Cloudflare n’est requis pour ces vérifications.

## Résultat du 13 septembre 2026

- `mise exec -- pnpm quality:fast` : réussi, dont 2 210 tests web et 37 tests Worker.
  Couverture des branches : 98,03 % web, 98,42 % Worker ; seuils inchangés.
- Les cinq nouveaux E2E ci-dessus et les trois parcours collaboratifs de
  [l’atelier](../tests/app/workshop/e2e/workshop-scenarios.spec.ts) passent.
  Les anciens parcours avec validation manuelle ont été adaptés à la saisie
  continue, à la fermeture indépendante des éditeurs et à la reprise réseau.
- `mise exec -- pnpm check` : format, types et qualité réussis ; E2E : 143 réussis
  sur 145. Les deux échecs sont reproduits à l’identique dans un checkout séparé
  de `HEAD` (`673c0ba`), sans les modifications de collaboration :
  - `ai-documentary-effort.spec.ts` attend un attachement latéral sous l’en-tête
    du groupe (`groupAttachmentBelowHeader`), alors que le layout actuel attache
    les groupes sur leurs faces principales.
  - `visual-tests.spec.ts` attend 32 scénarios dans le catalogue, qui en contient 33.
- `mise exec -- pnpm build`, exécuté séparément après l’arrêt du contrôle E2E :
  réussi pour le site et pour le Worker (`wrangler deploy --dry-run`).

Ces résultats valident la session dans le runtime Cloudflare local. Le contrôle
complet du dépôt reste rouge à cause des deux E2E préexistants ; aucun déploiement
n’a été effectué.
