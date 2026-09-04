import { useEffect, useState } from 'react';
import { AnimatedToastStack, type AnimatedToast } from '../motion/animated-toast-stack';
import { dismissToast, subscribeToasts } from '../../lib/toast';

export function ToastContainer() {
  const [items, setItems] = useState<AnimatedToast[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  return (
    <AnimatedToastStack
      toasts={items}
      onDismiss={dismissToast}
      position="bottom-right"
      placement="fixed"
    />
  );
}

export default ToastContainer;
