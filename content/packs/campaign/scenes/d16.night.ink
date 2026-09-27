# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
-> kari

// The levy came down from the pass (docs/tech-spec.md §51): Ulf's part in it, if he had one, and what the
// neighbours make of where you sent Kari.
=== kari ===
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
// The miser sent home on Day 13 (docs/tech-spec.md §59) walks.
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
Skögul sits on the end of the table with her supper. Thorvald sits down next to her without being asked.
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
