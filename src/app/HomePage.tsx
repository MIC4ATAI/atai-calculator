import { useOrgs } from '../org/OrgProvider';

/** Strona główna konsultanta. Lista sesji i „Nowa sesja” pojawiają się w kolejnym kroku. */
export function HomePage() {
  const { activeOrg } = useOrgs();

  return (
    <main className="page">
      <h1>Sesje</h1>
      <p className="lead">Organizacja: {activeOrg?.name}</p>
    </main>
  );
}
