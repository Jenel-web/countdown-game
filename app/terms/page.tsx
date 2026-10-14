import LegalPageLayout, { type LegalSection } from '@/components/LegalPageLayout';
import { APP_NAME } from '@/lib/legal';

export const metadata = { title: `Terms of Engagement | ${APP_NAME}` };

const sections: LegalSection[] = [
  {
    id: 'acceptance',
    title: 'Acceptance and eligibility',
    body: (
      <>
        <p>
          By creating an account or playing {APP_NAME}, you agree to these Terms of Engagement. If you do not agree,
          please do not use the app.
        </p>
        <p>
          If you are a minor, please use the app only with the knowledge of your parent or guardian.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts and usernames',
    body: (
      <>
        <p>
          You may sign up with a username and password, or with Google. Usernames must be unique, 3 to 20 characters,
          and made of letters, numbers and underscores.
        </p>
        <p>
          You are responsible for keeping your password secure and for activity under your account. Do not choose a
          username that is offensive, impersonates someone else, or infringes the rights of others.
        </p>
      </>
    ),
  },
  {
    id: 'fair-play',
    title: 'Fair play',
    body: (
      <p>
        Play honestly. Do not use cheats, bots, exploits, or any outside tool that gives you an unfair advantage in
        matches, and do not interfere with the servers or other players&apos; games. Ratings (MMR), wins and losses
        reflect fair competition only.
      </p>
    ),
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    body: (
      <p>
        We may suspend or remove accounts that break these terms. You may stop using the app at any time and may
        request deletion of your account as described in the Privacy Policy.
      </p>
    ),
  },
  {
    id: 'disclaimer',
    title: 'Disclaimer and limitation of liability',
    body: (
      <p>
        {APP_NAME} is provided &quot;as is&quot; without warranties of any kind. We do not guarantee uninterrupted
        service, and match results, ratings and statistics may be reset or corrected. To the extent permitted by
        law, we are not liable for indirect or incidental losses arising from use of the app.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: <p>These terms are governed by the laws of the Republic of the Philippines.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms from time to time. The &quot;Last updated&quot; date above shows the latest version.
        Continued use of the app after changes means you accept them.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Engagement"
      intro={`These terms set out the rules for using ${APP_NAME}.`}
      sections={sections}
    />
  );
}
