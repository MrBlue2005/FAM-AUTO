import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import FacebookPostPreview from './FacebookPostPreview';

export default function CampaignPreviewDrawer({ campaign, fallbackPosts = [], profileLabel, onClose }) {
  const posts = campaign.posts?.length ? campaign.posts : fallbackPosts;
  const [selectedPostIndex, setSelectedPostIndex] = useState(0);
  const selectedPost = posts[selectedPostIndex] || posts[0];
  const campaignTitle = campaign.name || campaign.title || campaign.id;

  useEffect(() => {
    const pageContent = document.querySelector('.page-content');
    if (!pageContent) return undefined;

    const previousOverflow = pageContent.style.overflow;
    const scrollTop = pageContent.scrollTop;
    pageContent.style.overflow = 'hidden';

    return () => {
      pageContent.style.overflow = previousOverflow;
      pageContent.scrollTop = scrollTop;
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop property-preview-backdrop" onMouseDown={onClose}>
      <section
        className="property-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview pentru ${campaignTitle}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>Preview postari</h2>
            <p>{campaignTitle}</p>
          </div>
          <button type="button" className="secondary-button small-button" onClick={onClose}>Inchide</button>
        </header>

        <div className="property-preview-tabs" role="tablist" aria-label="Alege ziua postarii">
          {posts.map((post, index) => (
            <button
              key={`${post.day}-${index}`}
              type="button"
              role="tab"
              aria-selected={selectedPostIndex === index}
              className={selectedPostIndex === index ? 'active' : ''}
              onClick={() => setSelectedPostIndex(index)}
            >
              Ziua {post.day || index + 1}
            </button>
          ))}
        </div>

        {selectedPost && (
          <FacebookPostPreview post={selectedPost} profileLabel={profileLabel} open hideToggle />
        )}
      </section>
    </div>,
    document.body
  );
}
