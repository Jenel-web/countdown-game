/**
 * lib/practiceFeedback.ts
 * Pure helper that turns a practice-mode result into overlay feedback.
 * Practice mode deliberately does NOT reuse multiplayer scoring thresholds.
 */

export const PRACTICE_THRESHOLDS = {
    /** Max distance from the target that still counts as "very close". */
    veryClose: 10,
} as const;

export type PracticeCategory = 'exact' | 'close' | 'far' | 'invalid';

export interface PracticeFeedback {
    category: PracticeCategory;
    title: string;
    message: string;
}

/**
 * @param target  The puzzle's target number.
 * @param result  The player's final value, or null if they have no valid solution.
 */
export function evaluatePractice(target: number, result: number | null): PracticeFeedback {
    if (result === null) {
        return {
            category: 'invalid',
            title: 'Not quite yet',
            message: "You haven't completed a valid solution yet. Give it another try!",
        };
    }

    const diff = Math.abs(result - target);

    if (diff === 0) {
        return {
            category: 'exact',
            title: 'Congratulations!',
            message: 'You hit the target perfectly!',
        };
    }

    if (diff <= PRACTICE_THRESHOLDS.veryClose) {
        return {
            category: 'close',
            title: 'So close!',
            message: 'You were just a little away from the target.',
        };
    }

    return {
        category: 'far',
        title: 'Good effort!',
        message: "Keep practicing—you'll get there soon.",
    };
}