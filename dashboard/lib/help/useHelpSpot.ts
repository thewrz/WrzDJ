import { useEffect, useRef } from 'react';
import { useHelp } from './HelpContext';

interface UseHelpSpotOptions {
  id: string;
  page: string;
  order: number;
  title: string;
  description: string;
}

export function useHelpSpot(options: UseHelpSpotOptions) {
  const { registerSpot } = useHelp();
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const deregister = registerSpot({
      id: options.id,
      page: options.page,
      order: options.order,
      title: options.title,
      description: options.description,
      ref,
    });
    return deregister;
  }, [options.id, options.page, options.order, options.title, options.description, registerSpot]);

  return ref;
}
