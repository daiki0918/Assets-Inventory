const MAX_PHOTO_BYTES = 1_200_000;

export const compressPhoto = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Could not read this image. Try another file.'));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error('This image could not be opened.'));
    image.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const photoUrl = canvas.toDataURL('image/jpeg', 0.8);
      if (photoUrl.length > MAX_PHOTO_BYTES) reject(new Error('Image is too large after compression. Choose a smaller photo.'));
      else resolve(photoUrl);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

export const capturePhoto = (video) => new Promise((resolve, reject) => {
  if (!video?.videoWidth || !video?.videoHeight) {
    reject(new Error('Camera is not ready yet. Try again in a moment.'));
    return;
  }
  const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('Could not capture this photo. Try again.'));
      return;
    }
    compressPhoto(new File([blob], 'asset-capture.jpg', { type: 'image/jpeg' })).then(resolve, reject);
  }, 'image/jpeg', 0.82);
});
