# draft
// FIRST DRAFT (M7; the pass rewritten in game phase 12): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
-> pass

// The levy came down from the pass (docs/tech-spec.md §51, §78): who didn't, the one chosen at dawn (Solveig's boy,
// unless you chose another); Ulf's part in it, if he had one; and what the neighbours make of where you sent him.
=== pass ===
{
- flag("chose_ulf"):
  -> ulf_fell
- flag("chose_aslak"):
  -> aslak_fell
}
-> kari_fell

=== kari_fell ===
{
- flag("ulf_levy") && home("brother"):
  # fx: family brother sick
  Ulf's letter is in a hand you hardly know: he's writing with the wrong one.
  "We held the pass till the sun came up. I was three shields down from Kari when the line went. I carried him as far as the cairn, and then I couldn't." # speaker: ulf
  "It's my arm, not my legs. Mother says I'm to stop writing and let it mend." # speaker: ulf
- flag("ulf_stayed") && home("brother"):
  Ulf's letter is three lines long.
  "Kari's shield came home on a cart this afternoon. I should have been next to him." # speaker: ulf
  "Don't write back that I shouldn't. I know you're right. That's worse." # speaker: ulf
- else:
  The letter from home is short. Solveig's boy didn't come down from the pass.
}
{
- flag("kari_ran"):
  Under it, in Bera's big slanting hand:
  "I dreamed of Solveig last night, at a loom by the sea, and her boy beside her, handing her the thread. I don't know what you did. Thank you for it." # speaker: bera
- flag("kari_valhalla"):
  Under it, in Bera's big slanting hand:
  "They say Kari's on Odin's benches now, with a horn in each hand. Solveig would have hated it, and been proud." # speaker: bera
}
-> hrapp

// Ulf, chosen: he died at dawn, so nobody at home writes in his hand.
=== ulf_fell ===
{
- home("mother"):
  Your mother's letter is very short, for her.
  "Ulf didn't come down from the pass. Kari carried him as far as the cairn, and then the others took turns." # speaker: mother
  "I've told Asa it was the snow. You'll tell her the same." # speaker: mother
- else:
  Your aunt writes for Asa. Ulf didn't come down from the pass. Kari carried him as far as the cairn, and then the others took turns. Asa has been told it was the snow.
}
-> hrapp

// Aslak, chosen: Solveig's boy came home, and Bera is a widow.
=== aslak_fell ===
{
- flag("ulf_levy") && home("brother"):
  # fx: family brother sick
  Ulf's letter is in a hand you hardly know: he's writing with the wrong one.
  "We held the pass till the sun came up. Old Aslak didn't come down. Kari and I carried him to the cairn between us, and then my arm gave out." # speaker: ulf
  "It's my arm, not my legs. Mother says I'm to stop writing and let it mend." # speaker: ulf
- flag("ulf_stayed") && home("brother"):
  Ulf's letter is three lines long.
  "Kari came home. Old Aslak didn't. Kari carried his shield to Bera's door himself, and stood in her yard till she came out." # speaker: ulf
  "I should have been up there. Don't write back that I shouldn't." # speaker: ulf
- else:
  The letter from home is short. Bera's man, old Aslak, didn't come down from the pass. Solveig's boy did.
}
Under it, in Bera's big slanting hand, smaller than usual:
{
- flag("aslak_valhalla"):
  "They say Aslak's on Odin's benches. He'll have found the seat nearest the fire, and be telling them about the pass, the first time. Kari sits with me in the evenings. He doesn't say much. Neither do I." # speaker: bera
- else:
  "Forty winters I fed that man, and I don't know where he is tonight. Kari sits with me in the evenings. He doesn't say much. Neither do I." # speaker: bera
}
-> hrapp

// The miser sent home on Day 13 (docs/tech-spec.md §59) walks.
=== hrapp ===
{ flag("hrapp_draugr"):
  At the very bottom, in Bera's hand, squeezed in sideways:
  { flag("kolskegg_judged"):
    "Old Hrapp Oddsson walked out of his barrow at the dark of the moon and sat on his own doorstep till dawn. Nobody goes up past the ford now, not since the Thorkelsson boy." # speaker: bera
  - else:
    "Old Hrapp Oddsson walked out of his barrow at the dark of the moon and sat on his own doorstep till dawn. Nobody goes up past the ford now." # speaker: bera
  }
}
-> thorvald

=== thorvald ===
{
- flag("thorvald16_returned"):
  At dusk Thorvald comes back up the path with his cap in his hands. # beat
  "Sent home again," he says. "My mother says I should stop trying." # speaker: thorvald
- flag("thorvald16_judged"):
  At dusk Thorvald comes back up the path with his cap in his hands. Wherever you sent him, they sent him straight back. Nobody down there wanted a man with a heartbeat. # beat
  "They were very nice about it," he says. "Mostly." # speaker: thorvald
- else:
  At dusk the broad man with the braided beard is still sitting at the end of the queue, where the sun ran out on him, with his cap in his hands. # beat
  "I'll come back tomorrow, shall I?" # speaker: thorvald
}
Skögul sits on the end of the table with her supper.
// What she says of the morning (docs/tech-spec.md §78), if anything: once.
{
- flag("chose_ulf"):
  She has put a second cup by your elbow. She doesn't say anything about it.
- flag("chose_aslak"):
  "Odin asked after the old man. I told him the pass held. He said it would have held anyway." # speaker: skogul
- flag("chose_none"):
  "You'll have to point yourself one day. I won't always be there to do it for you." # speaker: skogul
- flag("chose_kari"):
  She pushes a horn of mead across the table to you.
  "From Odin, for the boy at the pass. He doesn't often say thank you." # speaker: skogul
}
Thorvald sits down next to her without being asked.
{ flag("asked_twice"):
  "You asked me once if anyone ever came back twice," Skögul says to you, as if he isn't there. "That's him. He comes back every time." # speaker: skogul
}
"I thought it was today. I was sure. I'd slept three nights in a wood up in the hills, and something came out of the trees and trod on me, and I thought, this is it, Thorvald." # speaker: thorvald
"But nothing finds you in that wood. Not properly. Not even dying. Hoddmímir's wood, the old people call it." # speaker: thorvald
Skögul stops chewing.
* ["What's Hoddmímir's wood?"]
  # fx: flag truth +1
  # fx: flag wood_known
  Thorvald shrugs. Skögul puts down her bread.
  "It's in the old songs. When the fire comes, two people hide in that wood, and the fire doesn't find them. They live on the morning dew. After, they walk out into the new world and start again." # speaker: skogul
  "It's a song. It's only a song." # speaker: skogul
  She says it twice, which she never does. Thorvald looks from her to you and back, delighted, like a man who's just found out he's been lucky all along.
* ["Go home, Thorvald."]
  "Home. Yes. Good. I'll take the road this time. It's safer than the hills." # speaker: thorvald
  He goes off down the path whistling, trips over nothing, gets up, and goes on.
- The last of the light goes. Somewhere up in the hills, a long way off, there's a wood you can't see from here.
-> END
