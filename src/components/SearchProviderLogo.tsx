import type { SearchProviderId } from '../types';
import google from '../assets/search-providers/google.svg';
import bing from '../assets/search-providers/bing.svg';
import baidu from '../assets/search-providers/baidu.svg';
import duckduckgo from '../assets/search-providers/duckduckgo.svg';
import perplexity from '../assets/search-providers/perplexity.svg';
import chatgpt from '../assets/search-providers/chatgpt.svg';
import claude from '../assets/search-providers/claude.svg';
import { Icon } from './Icon';
import './SearchProviderLogo.css';

const logos: Record<Exclude<SearchProviderId, 'custom'>, string> = {
  google, bing, baidu, duckduckgo, perplexity, chatgpt, claude,
};

export function SearchProviderLogo({ provider, size = 24 }: { provider: SearchProviderId; size?: number }) {
  if (provider === 'custom') return <Icon name="link" size={size} />;
  return <img className={`search-provider-mark search-provider-mark--${provider}`}
    src={logos[provider]} width={size} height={size} alt="" aria-hidden draggable={false} />;
}
