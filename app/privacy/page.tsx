import LegalPageLayout, { type LegalSection } from '@/components/LegalPageLayout';
import { APP_NAME, PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_LABEL } from '@/lib/legal';

export const metadata = { title: `Data Privacy Protocols | ${APP_NAME}` };

const contact = (
  <p>
    {PRIVACY_CONTACT_LABEL}:{' '}
    <a className="text-primary-container hover:text-primary-fixed" href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
      {PRIVACY_CONTACT_EMAIL}
    </a>
  </p>
);

const sections: LegalSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <>
        <p>
          This policy explains how {APP_NAME} collects and uses your personal data, in line with the Data Privacy Act
          of 2012 (Republic Act No. 10173) of the Philippines. By ticking the acknowledgement when you register, you
          consent to the processing described here.
        </p>
        <p>If you are a minor, please use the app only with the knowledge of your parent or guardian.</p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <ul className="list-disc list-inside space-y-1">
        <li>Your username (stored as a generated sign-in address) or, if you use Google, your Google email address.</li>
        <li>Your password, which is stored only as a secure hash by our authentication provider. We never see it.</li>
        <li>Game data: rating (MMR), wins, losses, and match and round history.</li>
        <li>Session cookies and connection data needed to keep you signed in and to run live matches.</li>
      </ul>
    ),
  },
  {
    id: 'purpose',
    title: 'Why we collect it',
    body: (
      <p>
        We use this data only to create and secure your account, run matches, calculate ratings and show your
        statistics. We collect only what the game needs and do not sell your data or use it for advertising.
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'Who processes your data',
    body: (
      <p>
        We use Supabase to host our database and authentication, and Google if you choose to sign in with Google.
        These providers process data on our behalf. Other players can see your display name, rating and match
        results.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'Retention and security',
    body: (
      <p>
        We keep your data while your account is active and delete it when you ask us to. We protect it with hashed
        passwords, encrypted connections and access controls on our database. No system is perfectly secure, but we
        take reasonable organizational, physical and technical measures.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <p>Under the Data Privacy Act you have the right to:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>be informed about how your data is processed;</li>
          <li>access your personal data;</li>
          <li>correct inaccurate data;</li>
          <li>object to processing, or withdraw your consent;</li>
          <li>request the suspension, blocking or deletion of your data;</li>
          <li>obtain your data in a portable format;</li>
          <li>claim damages for any unlawful use of your data; and</li>
          <li>complain to the National Privacy Commission.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'requests',
    title: 'Requests and account deletion',
    body: (
      <>
        <p>
          To exercise any of these rights, or to have your account and data deleted, email us from the address linked
          to your account and tell us your username. We will act on your request within a reasonable time.
        </p>
        {contact}
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: (
      <p>
        We use only essential cookies that keep you signed in. We do not use advertising or tracking cookies.
      </p>
    ),
  },
  {
    id: 'breach',
    title: 'Data breaches',
    body: (
      <p>
        If a breach affects your personal data in a way that creates a real risk of serious harm, we will notify you
        and the National Privacy Commission within 72 hours of discovery, as required by law.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <>
        <p>We may update this policy. The &quot;Last updated&quot; date above shows the latest version.</p>
        {contact}
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Data Privacy Protocols"
      intro={`How ${APP_NAME} handles your personal data.`}
      sections={sections}
    />
  );
}
