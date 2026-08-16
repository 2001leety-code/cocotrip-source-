import { handleSocialMediaUpload } from './_shared/social-media-upload.js';

export default function handler(req, res) {
  return handleSocialMediaUpload(req, res);
}
