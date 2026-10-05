# draft
// FIRST DRAFT (docs/tech-spec.md §59): rewrite or sign off. Loki at the desk on Day 15, as the old woman Þökk, who
// wouldn't weep for Baldr, so Baldr stayed in Hel's hall (Gylfaginning); Móðguðr said on Day 14 that he waits there.
// Her tell is the one Loki wears that day (§80): `loki_guise` is its place among the guises in campaign.yaml (lips,
// salmon, mare, fly, seal), the lips until he's first caught. Night 18 remembers which answer you gave. The sun holds.
EXTERNAL flag(name)
The next in line isn't dead: an old woman in a grey shawl, with a basket over her arm and a face like a winter apple. She puts both elbows on your desk.
"Which way's the bridge?" she says. "The one with the gold roof. The quiet one." # speaker: thokk
"They tell me Baldr's down there, waiting. They tell me the whole world wept to get him out, every stone and every tree, and it didn't work, because one old woman in a cave wouldn't." # speaker: thokk
{
  - flag("loki_guise") == 1:
    She smiles. On her cheek a few scales catch the light, silver, like a fish's.
  - flag("loki_guise") == 2:
    She smiles. Her ears poke up through the shawl, tall and pointed, like a mare's, and turn to follow you.
  - flag("loki_guise") == 3:
    She smiles. A fly sits at the corner of her eye. She doesn't blink at it, and it doesn't leave.
  - flag("loki_guise") == 4:
    She smiles. The fingers on the basket's handle are webbed to the first knuckle, like a seal's.
  - else:
    She smiles. Her lips are thin, and there are small, old scars along them, like stitches that came out a long time ago.
}
"Þökk will weep dry tears for Baldr. That's what I told them. I'm told it's famous." # speaker: thokk
* { flag("loki_guise") == 0 } ["Your lips, grandmother."]
  # fx: flag saw_thokk
  # fx: standing loki +1
  She laughs, a young man's laugh out of an old woman's mouth, and for a moment the shawl doesn't quite fit.
  "Nobody ever looks at the lips. Well done. Keep looking." # speaker: thokk
* { flag("loki_guise") == 1 } ["Your cheek, grandmother."]
  # fx: flag saw_thokk
  # fx: standing loki +1
  She laughs, a young man's laugh out of an old woman's mouth, and for a moment the shawl doesn't quite fit.
  "Nobody ever looks at the cheeks. Well done. Keep looking." # speaker: thokk
* { flag("loki_guise") == 2 } ["Your ears, grandmother."]
  # fx: flag saw_thokk
  # fx: standing loki +1
  She laughs, a young man's laugh out of an old woman's mouth, and for a moment the shawl doesn't quite fit.
  "Nobody ever looks at the ears. Well done. Keep looking." # speaker: thokk
* { flag("loki_guise") == 3 } ["That fly, grandmother."]
  # fx: flag saw_thokk
  # fx: standing loki +1
  She laughs, a young man's laugh out of an old woman's mouth, and for a moment the shawl doesn't quite fit.
  "Nobody ever looks at the flies. Well done. Keep looking." # speaker: thokk
* { flag("loki_guise") == 4 } ["Your fingers, grandmother."]
  # fx: flag saw_thokk
  # fx: standing loki +1
  She laughs, a young man's laugh out of an old woman's mouth, and for a moment the shawl doesn't quite fit.
  "Nobody ever looks at the hands. Well done. Keep looking." # speaker: thokk
* ["The bridge is that way."]
  # fx: flag missed_thokk
  "Kind," she says, and pats your hand. Her fingers are warm, which the dead's never are. "So kind." # speaker: thokk
* ["Why wouldn't you weep?"]
  # fx: flag missed_thokk
  "Because he comes out anyway, after, when the fire's out. Somebody had to keep him somewhere safe till then." # speaker: thokk
  She taps the side of her nose. You aren't sure whose side she's on. You aren't sure she is.
- She goes off down the path against the flow of the dead, basket on her arm, and the queue parts for her without knowing why.
-> END
