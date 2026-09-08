export const twoByTwoInversionDocument = `
persistenceFormat = 2

[document]
id = "two-by-two-inversion"
title = "Two by two inversion"

[layout]
direction = "top-to-bottom"
bias = "top"

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.source-a]
nature = "goal"
markdown = "Source A"
layoutOrder = "a0"

[nodes.source-b]
nature = "goal"
markdown = "Source B"
layoutOrder = "a1"

[nodes.target-a]
nature = "goal"
markdown = "Target A"
layoutOrder = "a2"

[nodes.target-b]
nature = "goal"
markdown = "Target B"
layoutOrder = "a3"

[nodes.target-c]
nature = "goal"
markdown = "Target C"
layoutOrder = "a4"

[nodes.successor]
nature = "goal"
markdown = "Successor"
layoutOrder = "a5"

[junctions]

[relations.source-a-to-target-b]
from = "source-a"
to = "target-b"

[relations.source-b-to-target-a]
from = "source-b"
to = "target-a"

[relations.source-b-to-target-c]
from = "source-b"
to = "target-c"

[relations.target-a-to-successor]
from = "target-a"
to = "successor"

[relations.target-b-to-successor]
from = "target-b"
to = "successor"

[relations.target-c-to-successor]
from = "target-c"
to = "successor"
`;

export const crossingDocument = `
persistenceFormat = 2

[document]
id = "crossing-document"
title = "Crossing document"

[layout]
direction = "top-to-bottom"
bias = "top"

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.source-a]
nature = "goal"
markdown = "Source A"
layoutOrder = "a0"

[nodes.source-b]
nature = "goal"
markdown = "Source B"
layoutOrder = "a1"

[nodes.target-a]
nature = "goal"
markdown = "Target A"
layoutOrder = "a2"

[nodes.target-b]
nature = "goal"
markdown = "Target B"
layoutOrder = "a3"

[nodes.helper]
nature = "goal"
markdown = "Helper"
layoutOrder = "a4"

[nodes.successor]
nature = "goal"
markdown = "Successor"
layoutOrder = "a5"

[nodes.isolated]
nature = "goal"
markdown = "Isolated"
layoutOrder = "a6"

[junctions]

[relations.source-b-to-target-a]
from = "source-b"
to = "target-a"

[relations.source-a-to-helper]
from = "source-a"
to = "helper"

[relations.target-a-to-successor]
from = "target-a"
to = "successor"

[relations.target-b-to-successor]
from = "target-b"
to = "successor"

[relations.helper-to-successor]
from = "helper"
to = "successor"
`;
