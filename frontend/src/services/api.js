const API_URL = `${window.location.origin}/api`

export async function fetchImages() {
  const response = await fetch(`${API_URL}/images`)
  return response.json()
}

export async function removeImageFromDb(imageId) {
  const response = await fetch(`${API_URL}/images/${imageId}/remove`, { method: 'DELETE' })
  return response.json()
}

export async function deleteImageCompletely(imageId) {
  const response = await fetch(`${API_URL}/images/${imageId}/delete`, { method: 'DELETE' })
  return response.json()
}

export async function addTagToImage(imageId, tagId) {
  const response = await fetch(`${API_URL}/images/${imageId}/tag?tag_id=${tagId}`, { method: 'POST' })
  return response.json()
}

export async function removeTagFromImage(imageId, tagId) {
  const response = await fetch(`${API_URL}/images/${imageId}/tag?tag_id=${tagId}`, { method: 'DELETE' })
  return response.json()
}

export async function downloadImage(imageId, filename) {
  const response = await fetch(`${API_URL}/images/${imageId}/download`)
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function downloadMultipleImages(imageIds) {
  const response = await fetch(`${API_URL}/images/download-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(imageIds)
  })
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'images.zip'
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function fetchTags() {
  const response = await fetch(`${API_URL}/tags`)
  return response.json()
}

export async function createTag(name) {
  const response = await fetch(`${API_URL}/tags`, { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  })
  return response.json()
}

export async function deleteTag(tagId) {
  const response = await fetch(`${API_URL}/tags/${tagId}`, { method: 'DELETE' })
  return response.json()
}

export async function fetchFolders() {
  const response = await fetch(`${API_URL}/folders`)
  return response.json()
}

export async function browseFolders(path) {
  const response = await fetch(`${API_URL}/folders/browse?path=${encodeURIComponent(path)}`)
  return response.json()
}

export async function addFolder(path) {
  const response = await fetch(`${API_URL}/folders/add?path=${encodeURIComponent(path)}`, { method: 'POST' })
  return response.json()
}

export async function removeFolder(folderId) {
  const response = await fetch(`${API_URL}/folders/${folderId}`, { method: 'DELETE' })
  return response.json()
}

export async function rescanLibrary() {
  const response = await fetch(`${API_URL}/rescan`, { method: 'POST' })
  if (!response.ok) throw new Error(`Rescan failed: ${response.statusText}`)
  return response.json()
}

export async function startUpload(folderId, files) {
  const formData = new FormData()
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i])
  }
  const response = await fetch(`${API_URL}/images/upload/start?folder_id=${folderId}`, {
    method: 'POST',
    body: formData
  })
  return response.json()
}

export async function getUploadStatus(jobId) {
  const response = await fetch(`${API_URL}/images/upload/${jobId}/status`)
  return response.json()
}

export async function handleDuplicateAction(jobId, filename, action) {
  const response = await fetch(`${API_URL}/images/upload/${jobId}/duplicate-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, action })
  })
  return response.json()
}

export async function finalizeCropPositioning(jobId, filename, cropBox) {
  const response = await fetch(`${API_URL}/images/upload/${jobId}/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, crop_box: cropBox })
  })
  return response.json()
}

export async function skipCropPositioning(jobId, filename) {
  const response = await fetch(`${API_URL}/images/upload/${jobId}/position-skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  })
  return response.json()
}