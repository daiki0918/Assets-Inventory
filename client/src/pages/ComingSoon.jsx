import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';

export default function ComingSoon({ title, text }) {
  return <><PageHeader eyebrow="Workspace" title={title} description={text} /><div className="card"><Empty title="This page is planned" text="Phase 1 keeps the workspace focused on dashboard, inventory, and asset detail." /></div></>;
}
