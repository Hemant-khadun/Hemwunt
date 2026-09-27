import { Fragment } from 'react';
import type { Word } from '../animations/words';

/**
 * One line of words as the page's writer sets them (animations/words.ts):
 * each word in a slot of its own (`.story-slot`, which clips) that it rises
 * into, the accents in the italic serif. A slot per word rather than per line,
 * so a line that has to wrap on a narrow screen still sets every word through
 * its own floor. The story, the projects' intro, their hooks and the
 * statement all write through it, so they read in one voice.
 */
const WrittenLine = ({ words }: { words: Word[] }) => (
    <span className="story-line">
        {words.map((word, i) => (
            <Fragment key={i}>
                <span className="story-slot">
                    <span className={`story-word${word.accent ? ' story-accent' : ''}`}>{word.text}</span>
                </span>
                {i < words.length - 1 ? ' ' : null}
            </Fragment>
        ))}
    </span>
);

export default WrittenLine;
