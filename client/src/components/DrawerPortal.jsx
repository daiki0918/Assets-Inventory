import { createPortal } from 'react-dom';

export default function DrawerPortal({ children }) {
  return createPortal(children, document.body);
}
