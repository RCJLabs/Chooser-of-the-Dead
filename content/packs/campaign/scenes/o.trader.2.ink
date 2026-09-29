# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The trader's return (docs/tech-spec.md §72): the herring boats are in, and a share bought on the first night pays.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("gisli"): -> gone }
Gisli's letter smells of fish, which is how you know what it says before you read it.
"The herring's in. A hard season: the boats came home short of hands, and Solveig's is one of the names they don't say at the landing." # speaker: gisli
{ flag("gisli_share"):
  # fx: rings +35
  "Your share came to thirty-five rings. I've sent all of it. Your father would have kept a ring back for the steersman. I'm keeping nothing back, because he isn't here to see me do it." # speaker: gisli
- else:
  "Every share paid half as much again. Your father would have bought two. I'm not saying so. I'm writing it down, which is different." # speaker: gisli
}
* [Thank him.]
  You write that he's a better steersman on land than most men are at sea. He'll hang it on the wall, if he finds a wall.
* [Ask about the once.]
  "It was the autumn the ship didn't come home. I steered her onto the rocks because I was watching the sky and not the water. Your father said it wasn't my fault. He said it three times, going down. I'm still counting." # speaker: gisli
- Down in the mist, somebody's boat is scraping on shingle, a long way from any sea.
-> END

=== gone ===
The herring boats are in. Nobody writes to tell you, because the one who would have is gone, but the wind from the coast smells of it.
-> END
