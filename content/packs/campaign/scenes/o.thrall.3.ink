# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The freed thrall's last night (docs/tech-spec.md §72). It changes nothing: the ending follows from the run.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("kormak"): -> gone }
You think of Kormak, who'll be up before the sun tomorrow, if there is one.
{
- flag("kormak_drawn"):
  Ulf wrote once that your drawing of Skögul and her apple hangs over Kormak's bed. He'll be lying under it now, awake.
- flag("kormak_written"):
  Somebody at home reads him your letters, the ones in plain runes, and he listens with his eyes shut. They say he could say them all back by now.
}
{ flag("kormak_stamped"):
  He wears the tally with your stamp on it on a thong round his neck, and shows it to people who haven't asked.
}
{ flag("kormak_paid"):
  The third witness still tells anyone who'll listen about the freedom-ale, and how thin it was.
}
{
- flag("wood") || flag("ferryman") || flag("loki_deal"):
  Wherever they are going tonight, he'll have cut the way there on a strip of bark, so that nobody gets lost, and nobody needs to read.
- else:
  He'll have banked the fire at your mother's, and laid out tomorrow's wood, because tomorrow is a day like any other until it isn't.
}
* [Draw him a sun.]
  You cut it low on the edge of the bark, with rays like a hedgehog's, the way he does, and leave it on the table for the morning.
* [Leave the bark blank.]
  Some things don't need drawing. He'd say so himself, if he said things.
- The mist comes up from the battlefield and doesn't clear.
-> END

=== gone ===
You think of Kormak, who went down to Hel a free man, with nobody's name but his own. You hope they let him draw on the walls.
-> END
